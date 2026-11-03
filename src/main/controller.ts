import { EventEmitter } from 'node:events'
import { formatClock } from '../shared/format'
import { STATUS_TITLE, type DayRow, type Settings, type Snapshot, type Statistics, type SuspendReason } from '../shared/types'
import { ActivityMonitor, type IdleReader } from './activityMonitor'
import { TimerEngine } from './engine'
import { IdlePolicy } from './idlePolicy'
import type { Ledger } from './ledger'
import type { LedgerStore } from './persistence'
import { computeStatistics, historyRows } from './statistics'
import type { Instant, TimeSource } from './time'

/** System events, as emitted by Electron's `powerMonitor`. */
export interface PowerEvents {
  on(event: string, listener: () => void): unknown
  removeListener(event: string, listener: () => void): unknown
}

export interface Scheduler {
  /** Runs `callback` once after `delayMs`; returns a cancel function. */
  schedule(callback: () => void, delayMs: number): () => void
}

export const timerScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs)
    return () => clearTimeout(handle)
  }
}

export interface ControllerDependencies {
  time: TimeSource
  idle: IdleReader
  power: PowerEvents
  scheduler: Scheduler
  store: LedgerStore
  log?: (message: string) => void
}

export interface ControllerUpdate {
  snapshot: Snapshot
  stats: Statistics
}

/** How often the idle clock is read while a session is open, and otherwise. */
export const ACTIVE_POLL_MS = 500
export const IDLE_POLL_MS = 1000
/** Confirmed time is written at least this often while tracking. */
export const SAVE_INTERVAL_MS = 60_000

const SUSPEND_EVENTS: [start: string, end: string, reason: SuspendReason][] = [
  ['suspend', 'resume', 'systemSleep'],
  ['lock-screen', 'unlock-screen', 'screenLocked'],
  ['user-did-resign-active', 'user-did-become-active', 'sessionInactive']
]

/**
 * Connects the engine to the outside world: polls the idle clock, forwards sleep/lock/user
 * switching, saves to disk, and publishes one snapshot that every window and the menu bar share.
 * Emits `update` with a {@link ControllerUpdate}.
 */
export class TrackingController extends EventEmitter {
  private readonly monitor: ActivityMonitor
  private engine!: TimerEngine
  private cancelTick: (() => void) | null = null
  private readonly powerListeners: [string, () => void][] = []
  private lastSaveMono = 0
  private lastSnapshot: Snapshot | null = null
  private running = false

  constructor(private readonly deps: ControllerDependencies) {
    super()
    this.monitor = new ActivityMonitor(deps.idle)
  }

  get ledger(): Ledger {
    return this.engine.ledger
  }

  get snapshot(): Snapshot {
    return this.engine.snapshot(this.deps.time.now())
  }

  start(settings: Settings): void {
    const now = this.deps.time.now()
    this.engine = new TimerEngine(this.deps.store.load(), IdlePolicy.fromSettings(settings), now, settings.automaticTracking)
    this.lastSaveMono = now.mono
    if (this.deps.idle.isScreenLocked()) this.engine.suspend('screenLocked', now)
    // Prime the monitor so the last input from before launch is known and not reported again.
    this.monitor.poll(now)

    for (const [startEvent, endEvent, reason] of SUSPEND_EVENTS) {
      this.listen(startEvent, () => this.perform((at) => this.engine.suspend(reason, at)))
      this.listen(endEvent, () => this.perform((at) => this.engine.endSuspension(reason, at)))
    }
    // Logout, restart or shutdown: close and save now, but keep running in case it is cancelled.
    this.listen('shutdown', () => this.perform((at) => this.engine.shutdown(at)))

    this.running = true
    const snapshot = this.engine.snapshot(now)
    this.log(`Started: ${STATUS_TITLE[snapshot.status]}, today ${formatClock(snapshot.todayConfirmedMs)} confirmed`)
    this.tick()
  }

  /** Quit: closes the open session and writes confirmed time to disk. */
  shutdown(): void {
    if (!this.running) return
    this.running = false
    this.cancelTick?.()
    this.cancelTick = null
    for (const [event, listener] of this.powerListeners) this.deps.power.removeListener(event, listener)
    this.powerListeners.length = 0
    const now = this.deps.time.now()
    this.engine.shutdown(now)
    this.save(now)
    this.log(`Stopped: today ${formatClock(this.engine.snapshot(now).todayConfirmedMs)} confirmed and saved`)
  }

  // MARK: Ticking

  tick(): void {
    if (!this.running) return
    const now = this.deps.time.now()
    this.pollInput(now)
    this.refresh(now)
    this.scheduleNextTick(now)
  }

  private pollInput(now: Instant): void {
    const result = this.monitor.poll(now)
    if (result.kind === 'same') {
      this.engine.noteLatestInputBound(result.latestMono)
      return
    }
    this.reconcileLockState(now)
    this.engine.recordInput(result.input, result.bounds)
  }

  /** Backstop for a missed lock or unlock notification, checked whenever new input appears. */
  private reconcileLockState(now: Instant): void {
    const locked = this.deps.idle.isScreenLocked()
    if (locked && !this.engine.isSuspended('screenLocked')) {
      this.engine.suspend('screenLocked', now)
    } else if (!locked && this.engine.isSuspended('screenLocked')) {
      this.engine.endSuspension('screenLocked', now)
    }
  }

  private refresh(now: Instant): void {
    const snapshot = this.engine.snapshot(now)
    const previous = this.lastSnapshot
    this.lastSnapshot = snapshot

    const transition = previous !== null && (previous.status !== snapshot.status || previous.day !== snapshot.day)
    if (transition) {
      this.log(
        `${STATUS_TITLE[previous.status]} → ${STATUS_TITLE[snapshot.status]}: today ${formatClock(previous.todayTotalMs)} → ${formatClock(snapshot.todayTotalMs)}`
      )
    }
    if (this.engine.hasUnsavedChanges && (transition || now.mono - this.lastSaveMono >= SAVE_INTERVAL_MS)) {
      this.save(now)
    }
    this.emit('update', { snapshot, stats: computeStatistics(this.engine.ledger, snapshot) } satisfies ControllerUpdate)
  }

  /** Reads input often enough to stay responsive, at second boundaries of the display, and just after the expiry deadline. */
  private scheduleNextTick(now: Instant): void {
    const snapshot = this.lastSnapshot
    let delay = snapshot?.status === 'active' ? ACTIVE_POLL_MS : IDLE_POLL_MS
    if (snapshot?.status === 'active') {
      delay = Math.min(delay, 1000 - (snapshot.todayTotalMs % 1000) + 5)
    }
    const deadline = this.engine.expiryDeadline
    if (deadline !== null && deadline > now.mono) delay = Math.min(delay, deadline - now.mono + 5)
    this.cancelTick?.()
    this.cancelTick = this.deps.scheduler.schedule(() => this.tick(), Math.max(20, delay))
  }

  // MARK: Actions

  /** Runs a user action or system event against the engine, then saves and publishes the result. */
  private perform(action: (now: Instant) => void): void {
    if (!this.running) return
    const now = this.deps.time.now()
    this.pollInput(now)
    action(now)
    this.save(now)
    this.refresh(now)
    this.scheduleNextTick(now)
  }

  pause(): void {
    this.perform((now) => this.engine.pause(now))
  }

  resume(): void {
    this.perform((now) => this.engine.resume(now))
  }

  togglePause(): void {
    if (this.engine.isManuallyPaused) this.resume()
    else this.pause()
  }

  setTrackingEnabled(enabled: boolean): void {
    this.perform((now) => this.engine.setTrackingEnabled(enabled, now))
  }

  resetToday(): void {
    this.perform((now) => this.engine.resetToday(now))
  }

  resetAllData(): void {
    this.perform((now) => this.engine.resetAllData(now))
  }

  applySettings(settings: Settings): void {
    this.perform((now) => {
      this.engine.updatePolicy(IdlePolicy.fromSettings(settings), now)
      this.engine.setTrackingEnabled(settings.automaticTracking, now)
    })
  }

  history(): DayRow[] {
    return historyRows(this.engine.ledger, this.snapshot)
  }

  // MARK: Helpers

  private save(now: Instant): void {
    try {
      this.deps.store.save(this.engine.ledger)
      this.engine.markSaved()
      this.lastSaveMono = now.mono
    } catch (error) {
      this.log(`Saving failed: ${(error as Error).message}`)
    }
  }

  private listen(event: string, listener: () => void): void {
    this.deps.power.on(event, listener)
    this.powerListeners.push([event, listener])
  }

  private log(message: string): void {
    this.deps.log?.(message)
  }
}
