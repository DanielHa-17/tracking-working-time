import { addDays, dayKey, startOfDay } from '../shared/days'
import type { Snapshot, SuspendReason, TrackingStatus } from '../shared/types'
import type { InputBounds } from './activityMonitor'
import { IdlePolicy } from './idlePolicy'
import { Ledger } from './ledger'
import { instantAt, type Instant } from './time'

interface OpenSession {
  start: Instant
  /** Input that the confirmed total runs up to. */
  lastInput: Instant
  /**
   * Latest monotonic time at which that input can have happened. Inactivity is measured from
   * here, so a session never expires before the threshold has really passed.
   */
  inactiveSince: number
  confirmedMs: number
}

const SUSPEND_PRIORITY: Record<SuspendReason, number> = { systemSleep: 3, screenLocked: 2, sessionInactive: 1 }

/**
 * The single authoritative time-accounting state machine.
 *
 * Inputs, ticks and system events are fed in with their timestamps; the engine never reads a
 * clock itself, so it behaves identically in tests with a simulated clock.
 *
 * Accounting rule (strict retroactive exclusion):
 * - The first input after a break opens a session at that input's time.
 * - Time after the latest input is provisional.
 * - An input before the threshold confirms the interval since the previous input.
 * - Reaching the threshold discards the interval since the last input and closes the session.
 * - Sleep, lock and user switching close the session and discard the provisional interval.
 */
export class TimerEngine {
  /** Wall-vs-monotonic divergence that reveals a sleep (or a forward clock change) since the last input. */
  static readonly sleepToleranceMs = 2000

  private session: OpenSession | null = null
  private readonly suspensions = new Set<SuspendReason>()
  private manuallyPaused = false
  private trackingEnabled: boolean
  /** Nothing at or before this monotonic time may be counted (again). */
  private watermark: number
  private lastObservedInput: Instant | null = null
  private dirty = false

  constructor(
    readonly ledger: Ledger,
    private policy: IdlePolicy,
    now: Instant,
    trackingEnabled = true
  ) {
    this.trackingEnabled = trackingEnabled
    // Input from before launch was not monitored, so it must not start a session.
    this.watermark = now.mono
  }

  // MARK: State

  get status(): TrackingStatus {
    if (!this.trackingEnabled) return 'disabled'
    let reason: SuspendReason | null = null
    for (const candidate of this.suspensions) {
      if (!reason || SUSPEND_PRIORITY[candidate] > SUSPEND_PRIORITY[reason]) reason = candidate
    }
    if (reason) return reason
    if (this.manuallyPaused) return 'paused'
    return this.session ? 'active' : 'idle'
  }

  get isManuallyPaused(): boolean {
    return this.manuallyPaused
  }

  get isTrackingEnabled(): boolean {
    return this.trackingEnabled
  }

  get currentPolicy(): IdlePolicy {
    return this.policy
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty
  }

  isSuspended(reason: SuspendReason): boolean {
    return this.suspensions.has(reason)
  }

  /** Monotonic time at which the open session expires, if one is open. */
  get expiryDeadline(): number | null {
    return this.session ? this.session.inactiveSince + this.policy.thresholdMs : null
  }

  private get canCount(): boolean {
    return this.trackingEnabled && !this.manuallyPaused && this.suspensions.size === 0
  }

  // MARK: Input

  /**
   * Records keyboard, mouse or trackpad activity that happened at `input`. When the time is only
   * known approximately (whole-second idle readings), `bounds` says what is certain, and `input`
   * is the latest possible time. Duplicate and out-of-order reports are harmless: each interval
   * is committed once.
   */
  recordInput(input: Instant, bounds: InputBounds = { earliestMono: input.mono, previousPollMono: input.mono }): void {
    if (!this.lastObservedInput || input.mono > this.lastObservedInput.mono) this.lastObservedInput = input
    // Expire only if the inactivity certainly reached the threshold before this input.
    this.advance(instantAt(input, Math.min(bounds.previousPollMono, input.mono)))
    // Count it only if it certainly happened after launch, the last pause or the last unlock.
    if (!this.canCount || bounds.earliestMono <= this.watermark) return

    const open = this.session
    if (open) {
      const gap = input.mono - open.lastInput.mono
      if (gap <= 0) return
      this.commit(open.lastInput, input)
      open.confirmedMs += gap
      open.lastInput = input
      open.inactiveSince = input.mono
    } else {
      this.session = { start: input, lastInput: input, inactiveSince: input.mono, confirmedMs: 0 }
    }
  }

  /**
   * A fresh reading says the most recent input happened no later than `mono`. Inactivity is
   * measured from there (or from the session start, if the session began later, for example with
   * the Resume button). The bound may move later, when an input was too close to the previous one
   * to be told apart, which keeps expiry from ever coming early.
   */
  noteLatestInputBound(mono: number): void {
    const open = this.session
    if (!open || !Number.isFinite(mono)) return
    open.inactiveSince = Math.max(open.start.mono, mono)
  }

  /** Applies everything that follows from time passing: inactivity expiry and unnoticed sleep. */
  advance(now: Instant): void {
    const open = this.session
    if (!open) return
    const elapsed = now.mono - open.lastInput.mono
    if (elapsed <= 0) return

    if (now.wall - open.lastInput.wall - elapsed > TimerEngine.sleepToleranceMs) {
      // The Mac slept (or the clock jumped forward) after the last input: nothing after it is confirmed.
      this.closeSession(open.lastInput)
      return
    }

    if (!this.policy.hasExpired(now.mono - open.inactiveSince)) return
    const retained = this.policy.retainedOnExpiryMs
    if (retained > 0) {
      const end = instantAt(open.lastInput, open.lastInput.mono + retained)
      this.commit(open.lastInput, end)
      open.confirmedMs += retained
      open.lastInput = end
      this.closeSession(end)
    } else {
      this.closeSession(open.lastInput)
    }
  }

  // MARK: User actions

  pause(now: Instant): void {
    if (this.manuallyPaused) return
    this.advance(now)
    this.endSessionByUser(now)
    this.manuallyPaused = true
    this.dirty = true
  }

  /** Pressing Resume is itself user input, so a session opens immediately. */
  resume(now: Instant): void {
    if (!this.manuallyPaused) return
    this.manuallyPaused = false
    this.openSessionByUser(now)
  }

  setTrackingEnabled(enabled: boolean, now: Instant): void {
    if (enabled === this.trackingEnabled) return
    if (enabled) {
      this.trackingEnabled = true
      this.openSessionByUser(now)
    } else {
      this.advance(now)
      this.endSessionByUser(now)
      this.trackingEnabled = false
    }
  }

  updatePolicy(policy: IdlePolicy, now: Instant): void {
    if (policy.equals(this.policy)) return
    this.advance(now)
    this.policy = policy
    // A shorter threshold applies to the inactivity already in progress.
    this.advance(now)
  }

  resetToday(now: Instant): void {
    this.advance(now)
    this.ledger.removeDay(dayKey(now.wall))
    this.restartOpenSession(now)
    this.dirty = true
  }

  resetAllData(now: Instant): void {
    this.advance(now)
    this.ledger.removeAll()
    this.restartOpenSession(now)
    this.dirty = true
  }

  // MARK: System events

  /** Sleep, lock or user switch. The provisional interval is always excluded: the user may have left. */
  suspend(reason: SuspendReason, now: Instant): void {
    this.advance(now)
    if (this.session) this.closeSession(this.session.lastInput)
    this.suspensions.add(reason)
    this.watermark = Math.max(this.watermark, now.mono)
  }

  /** Wake, unlock or switch back. Tracking waits for the next real input. */
  endSuspension(reason: SuspendReason, now: Instant): void {
    if (!this.suspensions.delete(reason)) return
    this.watermark = Math.max(this.watermark, now.mono)
  }

  /** Quit or power off: close the session so that a relaunch restores only confirmed time. */
  shutdown(now: Instant): void {
    this.advance(now)
    this.endSessionByUser(now)
  }

  markSaved(): void {
    this.dirty = false
  }

  // MARK: Reading

  /** Brings the engine up to `now` and describes it. Reading repeatedly never changes the totals. */
  snapshot(now: Instant): Snapshot {
    this.advance(now)
    const today = dayKey(now.wall)
    const todayRow = this.ledger.day(today)
    const open = this.session

    let provisionalMs = 0
    let sessionMs = 0
    let untilExclusionMs: number | null = null
    if (open) {
      provisionalMs = Math.max(0, now.mono - open.lastInput.mono)
      sessionMs = open.confirmedMs + provisionalMs
      untilExclusionMs = Math.max(0, this.policy.thresholdMs - (now.mono - open.inactiveSince))
    }
    const provisionalToday = Math.min(provisionalMs, Math.max(0, now.wall - startOfDay(now.wall)))

    return {
      status: this.status,
      day: today,
      todayTotalMs: Math.max(0, todayRow.activeMs + provisionalToday),
      todayConfirmedMs: todayRow.activeMs,
      provisionalMs,
      sessionMs,
      sessionStart: open ? open.start.wall : null,
      sessionsToday: todayRow.sessions + (open ? 1 : 0),
      longestSessionTodayMs: Math.max(todayRow.longestSessionMs, sessionMs),
      lastInputAt: this.lastObservedInput ? this.lastObservedInput.wall : null,
      inactivityMs: this.lastObservedInput ? Math.max(0, now.mono - this.lastObservedInput.mono) : null,
      untilExclusionMs,
      thresholdMs: this.policy.thresholdMs,
      strictExclusion: this.policy.strictExclusion
    }
  }

  // MARK: Accounting

  private commit(start: Instant, end: Instant): void {
    const duration = end.mono - start.mono
    if (duration <= 0) return
    for (const [day, portion] of TimerEngine.distribute(duration, end.wall)) {
      this.ledger.addActive(day, portion)
    }
    this.dirty = true
  }

  private closeSession(end: Instant): void {
    const open = this.session
    if (!open) return
    this.session = null
    this.watermark = Math.max(this.watermark, end.mono)
    if (open.confirmedMs <= 0) return
    const startDay = dayKey(open.start.wall)
    this.ledger.recordSession(startDay, open.start.wall, end.wall, open.confirmedMs)
    this.ledger.pruneSessions(addDays(startDay, -Ledger.sessionRetentionDays))
    this.dirty = true
  }

  /** Pause, quit, or tracking off. Strict mode drops the provisional tail; lenient mode keeps it. */
  private endSessionByUser(now: Instant): void {
    const open = this.session
    if (!open) return
    if (!this.policy.strictExclusion) {
      const tail = now.mono - open.lastInput.mono
      if (tail > 0) {
        this.commit(open.lastInput, now)
        open.confirmedMs += tail
        open.lastInput = now
      }
    }
    this.closeSession(open.lastInput)
    this.watermark = Math.max(this.watermark, now.mono)
  }

  private openSessionByUser(now: Instant): void {
    if (!this.canCount || this.session || now.mono <= this.watermark) return
    this.session = { start: now, lastInput: now, inactiveSince: now.mono, confirmedMs: 0 }
  }

  private restartOpenSession(now: Instant): void {
    if (this.session) this.session = { start: now, lastInput: now, inactiveSince: now.mono, confirmedMs: 0 }
    this.watermark = Math.max(this.watermark, now.mono)
  }

  /**
   * Splits a duration that ended at wall time `end` across the local calendar days it covers.
   * The total is exact; only the split points depend on the wall clock.
   */
  static distribute(duration: number, end: number): [string, number][] {
    const portions: [string, number][] = []
    let remaining = duration
    let cursor = end
    while (remaining > 0) {
      // A moment just before the cursor decides the day, so an interval ending at midnight
      // belongs to the day before.
      const probe = cursor - 0.001
      const start = startOfDay(probe)
      const available = cursor - start
      const portion = available > 0 && portions.length < 366 ? Math.min(remaining, available) : remaining
      portions.push([dayKey(probe), portion])
      remaining -= portion
      cursor = start
    }
    return portions
  }
}
