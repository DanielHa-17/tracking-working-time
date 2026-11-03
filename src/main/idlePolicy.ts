/** When inactivity ends a session, and what happens to the unconfirmed time. */
export class IdlePolicy {
  readonly thresholdMs: number

  /**
   * @param thresholdMs inactivity that ends a session (default five minutes, minimum one second)
   * @param strictExclusion true: the whole interval since the last input is discarded.
   *   false: the threshold itself is kept as a grace period.
   */
  constructor(thresholdMs = 300_000, readonly strictExclusion = true) {
    this.thresholdMs = Math.max(1000, thresholdMs)
  }

  static fromSettings(settings: { thresholdSeconds: number; strictExclusion: boolean }): IdlePolicy {
    return new IdlePolicy(settings.thresholdSeconds * 1000, settings.strictExclusion)
  }

  /** Inactivity of exactly the threshold counts as expired; anything shorter does not. */
  hasExpired(inactiveMs: number): boolean {
    return inactiveMs >= this.thresholdMs
  }

  get retainedOnExpiryMs(): number {
    return this.strictExclusion ? 0 : this.thresholdMs
  }

  equals(other: IdlePolicy): boolean {
    return this.thresholdMs === other.thresholdMs && this.strictExclusion === other.strictExclusion
  }
}
