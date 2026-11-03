/**
 * A moment as seen by two clocks.
 *
 * - `mono`: monotonic milliseconds from `process.hrtime` (mach_absolute_time on macOS). It never
 *   jumps when the user changes the clock, and it pauses while the Mac sleeps. Every duration
 *   comes from this clock.
 * - `wall`: epoch milliseconds. Used only to decide which calendar day time belongs to.
 */
export interface Instant {
  readonly mono: number
  readonly wall: number
}

export interface TimeSource {
  now(): Instant
}

export const systemTime: TimeSource = {
  now: () => ({ mono: Number(process.hrtime.bigint()) / 1e6, wall: Date.now() })
}

/** The instant `mono` milliseconds on the monotonic clock, expressed relative to `reference`. */
export function instantAt(reference: Instant, mono: number): Instant {
  return { mono, wall: reference.wall - (reference.mono - mono) }
}
