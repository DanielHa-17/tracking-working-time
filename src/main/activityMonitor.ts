import { instantAt, type Instant } from './time'

/**
 * Reads the system-wide idle clock. In the app this is Electron's `powerMonitor`, which on macOS
 * asks the HID system how long ago the last keyboard, mouse or trackpad event happened. No event
 * tap, no Accessibility or Input Monitoring permission, and no key codes or positions: only a
 * number of seconds.
 *
 * Limitation: the HID idle clock cannot tell physical input from synthetic events posted by
 * software (remote desktop, automation tools, "mouse jigglers"); those count as activity.
 */
export interface IdleReader {
  /** Whole seconds since the last input event, rounded down (Electron reports integers). */
  idleSeconds(): number
  /** True while the login window or lock screen is in front. */
  isScreenLocked(): boolean
}

/** What the engine needs to know about a newly detected input. */
export interface InputBounds {
  /** The newest input happened after this monotonic time (and at or before `input`). */
  earliestMono: number
  /**
   * The previous reading saw no input after the one before, so the first new input came after
   * this time. Inactivity is certain only up to here.
   */
  previousPollMono: number
}

export type PollResult =
  | { kind: 'input'; input: Instant; bounds: InputBounds }
  /** No new input detected; the latest input happened no later than `latestMono`. */
  | { kind: 'same'; latestMono: number }

/**
 * Turns whole-second idle readings into input times.
 *
 * A reading of `n` seconds at time `t` means the last input happened in (t − n − 1 s, t − n].
 * Readings of the same input overlap, so their intersection narrows the range over time, and a
 * reading that lies entirely after that range can only come from a newer input. Two inputs less
 * than a second apart can look like one; then the newer one is picked up a moment later. Every
 * reported time is the latest possible one, so the five-minute rule never triggers early.
 */
export class ActivityMonitor {
  /** Allowance for the idle clock and the monotonic clock ticking slightly apart. */
  static readonly jitterMs = 25

  private earliest = Number.NEGATIVE_INFINITY
  private latest = Number.NEGATIVE_INFINITY
  private previousPoll = Number.NEGATIVE_INFINITY

  constructor(private readonly reader: IdleReader) {}

  poll(now: Instant): PollResult {
    const idleMs = Math.max(0, Math.floor(this.reader.idleSeconds())) * 1000
    const latest = now.mono - idleMs
    const earliest = latest - 1000
    const previousPollMono = this.previousPoll
    this.previousPoll = now.mono

    if (earliest >= this.latest + ActivityMonitor.jitterMs) {
      this.earliest = earliest
      this.latest = latest
      return { kind: 'input', input: instantAt(now, latest), bounds: { earliestMono: earliest, previousPollMono } }
    }
    if (latest < this.earliest - ActivityMonitor.jitterMs) {
      // The reading moved backwards (for example the idle clock kept counting during sleep while
      // the monotonic clock paused). It reveals no new input and no usable bound.
      this.earliest = earliest
      this.latest = latest
      return { kind: 'same', latestMono: Number.POSITIVE_INFINITY }
    }
    this.earliest = Math.max(this.earliest, earliest)
    this.latest = Math.max(this.earliest, Math.min(this.latest, latest))
    // Only this reading's own bound is safe: the narrowed range assumes no input was missed.
    return { kind: 'same', latestMono: latest }
  }
}
