import { describe, expect, it } from 'vitest'
import { TimerEngine } from '../src/main/engine'
import { IdlePolicy } from '../src/main/idlePolicy'
import { Ledger } from '../src/main/ledger'
import { computeStatistics } from '../src/main/statistics'
import type { SuspendReason } from '../src/shared/types'
import { at, day, EngineHarness, expectSeconds, random } from './support'

describe('five-minute strict exclusion', () => {
  it('299 seconds of inactivity do not trigger the rollback', () => {
    const e = new EngineHarness()
    e.input(1)
    e.input(60)

    const snapshot = e.wait(299)
    expect(snapshot.status).toBe('active')
    expectSeconds(snapshot.todayConfirmedMs, 60)
    expectSeconds(snapshot.provisionalMs, 299)
    expectSeconds(snapshot.todayTotalMs, 359)

    expect(e.wait(0.999).status, '299.999 s is still below the threshold').toBe('active')
    e.input()
    expectSeconds(e.totalConfirmedMs, 359.999)
  })

  it('reaching exactly 300 seconds rolls back the whole unconfirmed interval', () => {
    const e = new EngineHarness()
    e.input(1)
    e.input(60)

    expect(e.wait(299.999).status).toBe('active')
    const snapshot = e.wait(0.001)
    expect(snapshot.status).toBe('idle')
    expectSeconds(snapshot.todayTotalMs, 60)
    expect(snapshot.provisionalMs).toBe(0)
    expect(snapshot.sessionMs).toBe(0)
    expect(e.engine.ledger.day(snapshot.day)).toMatchObject({ sessions: 1, longestSessionMs: 60_000 })
  })

  it('excludes exactly the 300 provisional seconds and stays frozen while idle', () => {
    const strict = new EngineHarness()
    const lenient = new EngineHarness({ policy: new IdlePolicy(300_000, false) })
    for (const e of [strict, lenient]) {
      e.input(1)
      e.input(120)
    }
    expectSeconds(strict.wait(299.5).todayTotalMs, 419.5)
    const after = strict.wait(0.5)
    expect(after.status).toBe('idle')
    expect(after.todayTotalMs, 'confirmed time before the last input is untouched').toBe(120_000)
    expect(strict.wait(3600).todayTotalMs, 'the timer stays frozen while idle').toBe(120_000)

    lenient.wait(300)
    expect(lenient.confirmedMs(after.day) - strict.confirmedMs(after.day)).toBe(300_000)
  })

  it('an input after 299 s continues the same session', () => {
    const e = new EngineHarness()
    e.input(1)
    const sessionStart = e.snapshot.sessionStart
    e.input(299)
    expect(e.snapshot).toMatchObject({ status: 'active', sessionStart, sessionsToday: 1 })
    expectSeconds(e.snapshot.todayConfirmedMs, 299)
    e.input(299.999)
    expectSeconds(e.totalConfirmedMs, 598.999)
    expect(e.snapshot.sessionStart).toBe(sessionStart)
  })

  it('an input known only to lie in a range never expires the session early', () => {
    const e = new EngineHarness()
    e.input(1)
    e.clock.advance(300.4)
    // The previous reading, 0.5 s ago, still saw no new input: only 299.9 s of inactivity are certain.
    e.engine.recordInput(e.clock.now(), { earliestMono: e.clock.mono - 1000, previousPollMono: e.clock.mono - 500 })
    expect(e.snapshot.status).toBe('active')
    expect(e.snapshot.sessionsToday).toBe(1)

    // Here 300.7 s of inactivity are certain, so the session ends and the input starts a new one.
    e.clock.advance(301.2)
    e.engine.recordInput(e.clock.now(), { earliestMono: e.clock.mono - 1000, previousPollMono: e.clock.mono - 500 })
    expect(e.snapshot.sessionsToday).toBe(2)
  })

  it('inactivity is measured from the latest bound on the last input, never before the session started', () => {
    const e = new EngineHarness()
    e.input(1)
    const start = e.clock.mono
    e.input(10)
    e.engine.noteLatestInputBound(e.clock.mono - 400)
    expect(e.engine.expiryDeadline).toBe(e.clock.mono - 400 + 300_000)
    e.engine.noteLatestInputBound(e.clock.mono + 600) // an input too close to tell apart
    expect(e.engine.expiryDeadline).toBe(e.clock.mono + 600 + 300_000)
    e.engine.noteLatestInputBound(start - 5000)
    expect(e.engine.expiryDeadline).toBe(start + 300_000)
  })
})

describe('midnight, daylight saving and clock changes', () => {
  it('assigns time on both sides of midnight to the right dates', () => {
    const e = new EngineHarness({ start: at(2026, 3, 10, 23, 57, 59) })
    e.input(1) // 23:58:00
    for (let index = 0; index < 8; index += 1) e.input(30) // … 00:02:00

    expectSeconds(e.confirmedMs(day(2026, 3, 10)), 120)
    expectSeconds(e.confirmedMs(day(2026, 3, 11)), 120)
    expect(e.snapshot.day).toBe(day(2026, 3, 11))
    expectSeconds(e.snapshot.todayTotalMs, 120)

    e.wait(300)
    expect(e.engine.ledger.day(day(2026, 3, 10))).toMatchObject({ sessions: 1, longestSessionMs: 240_000 })
    expect(e.engine.ledger.day(day(2026, 3, 11)).sessions).toBe(0)
  })

  it('excludes provisional time that crossed midnight from both days', () => {
    const e = new EngineHarness({ start: at(2026, 3, 10, 23, 57, 59) })
    e.input(1) // 23:58:00, then nothing
    const afterMidnight = e.wait(180) // 00:01:00
    expect(afterMidnight.day).toBe(day(2026, 3, 11))
    expectSeconds(afterMidnight.todayTotalMs, 60)

    const idle = e.wait(120)
    expect(idle.status).toBe('idle')
    expect(idle.todayTotalMs).toBe(0)
    expect(e.confirmedMs(day(2026, 3, 10))).toBe(0)

    const confirmed = new EngineHarness({ start: at(2026, 3, 10, 23, 57, 59) })
    confirmed.input(1)
    confirmed.input(180)
    expectSeconds(confirmed.confirmedMs(day(2026, 3, 10)), 120)
    expectSeconds(confirmed.confirmedMs(day(2026, 3, 11)), 60)
  })

  it('uses real elapsed time across a daylight saving change', () => {
    // Europe/Berlin skips 02:00–03:00 on 29 March 2026.
    const e = new EngineHarness({ start: at(2026, 3, 29, 1, 58, 59) })
    e.input(1) // 01:59:00 CET
    e.input(120) // 03:01:00 CEST
    expectSeconds(e.confirmedMs(day(2026, 3, 29)), 120)
    expectSeconds(e.totalConfirmedMs, 120)
  })

  it('never lets a clock change alter durations', () => {
    const e = new EngineHarness({ start: at(2026, 3, 10, 12, 0) })
    e.input(1)
    e.clock.shiftWall(-3600) // backwards: durations unaffected
    e.input(30)
    expectSeconds(e.totalConfirmedMs, 30)

    e.clock.shiftWall(-24 * 3600) // back across midnight: only the day label changes
    e.input(30)
    expectSeconds(e.totalConfirmedMs, 60)
    expectSeconds(e.confirmedMs(day(2026, 3, 10)), 30)
    expectSeconds(e.confirmedMs(day(2026, 3, 9)), 30)

    // A forward jump looks like an unnoticed sleep. The unconfirmed interval is dropped rather
    // than guessed, and nothing is ever added for the jump itself.
    e.clock.shiftWall(7200)
    e.input(30)
    expectSeconds(e.totalConfirmedMs, 60)
    expect(e.snapshot.status).toBe('active')
    e.input(30)
    expectSeconds(e.totalConfirmedMs, 90)
  })
})

describe('robustness', () => {
  it('does not double count repeated, duplicate or out-of-order reports', () => {
    const e = new EngineHarness()
    e.input(1)
    let previous = e.clock.now()
    for (let index = 0; index < 1000; index += 1) {
      e.clock.advance(0.001)
      const now = e.clock.now()
      e.engine.recordInput(now)
      e.engine.recordInput(now)
      e.engine.recordInput(previous)
      previous = now
    }
    expectSeconds(e.totalConfirmedMs, 1)
    expect(e.snapshot.sessionsToday).toBe(1)
  })

  it('never produces a negative value or more time than has passed', () => {
    const next = random(0xc0ffee)
    const e = new EngineHarness()
    const origin = e.clock.mono
    const reasons: SuspendReason[] = ['systemSleep', 'screenLocked', 'sessionInactive']
    const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)]

    for (let step = 0; step < 5000; step += 1) {
      const now = e.clock.now()
      const choice = Math.floor(next() * 14)
      if (choice <= 4) e.input(next() * 420)
      else if (choice === 5) e.wait(next() * 900)
      else if (choice === 6) e.engine.pause(now)
      else if (choice === 7) e.engine.resume(now)
      else if (choice === 8) e.engine.resetToday(now)
      else if (choice === 9) e.clock.shiftWall((next() * 2 - 1) * 172_800)
      else if (choice === 10) e.engine.suspend(pick(reasons), now)
      else if (choice === 11) e.engine.endSuspension(pick(reasons), now)
      else if (choice === 12) e.clock.sleep(next() * 600)
      else e.engine.updatePolicy(new IdlePolicy((1 + Math.floor(next() * 10)) * 60_000, next() < 0.5), now)

      const s = e.snapshot
      for (const value of [s.todayTotalMs, s.todayConfirmedMs, s.provisionalMs, s.sessionMs]) {
        expect(value, `step ${step}`).toBeGreaterThanOrEqual(0)
      }
      for (const row of e.engine.ledger.rows()) expect(row.activeMs).toBeGreaterThanOrEqual(0)
      expect(e.totalConfirmedMs, `step ${step}`).toBeLessThanOrEqual(e.clock.mono - origin)
    }
  })

  it('a manual pause cannot be undone by input, and Resume starts counting at once', () => {
    const e = new EngineHarness()
    e.input(1)
    e.input(30)
    e.engine.pause(e.clock.now())
    for (let index = 0; index < 5; index += 1) e.input(10)
    expect(e.snapshot.status).toBe('paused')
    expectSeconds(e.totalConfirmedMs, 30)
    e.engine.resume(e.clock.now())
    expect(e.snapshot.status).toBe('active')
    e.input(9)
    expectSeconds(e.totalConfirmedMs, 39)
  })
})

describe('statistics and resets', () => {
  it('aggregates confirmed history', () => {
    const hour = 3_600_000
    const ledger = new Ledger()
    ledger.addActive(day(2026, 3, 10), 2 * hour) // yesterday (Tuesday)
    ledger.addActive(day(2026, 3, 9), 1 * hour) // Monday, this week
    ledger.addActive(day(2026, 3, 2), 3 * hour) // last week, this month
    ledger.addActive(day(2026, 2, 27), 4 * hour) // last month, within 30 days
    ledger.addActive(day(2026, 1, 1), 5 * hour) // outside every window

    const e = new EngineHarness({ start: at(2026, 3, 11, 9, 0) })
    const snapshot = { ...e.snapshot, todayTotalMs: hour / 2, longestSessionTodayMs: hour / 4 }
    expect(computeStatistics(ledger, snapshot)).toEqual({
      todayMs: hour / 2,
      yesterdayMs: 2 * hour,
      thisWeekMs: hour / 2 + 3 * hour,
      thisMonthMs: hour / 2 + 6 * hour,
      activeDaysInAverage: 5,
      dailyAverageMs: (hour / 2 + 10 * hour) / 5,
      longestSessionTodayMs: hour / 4
    })
  })

  it('Reset Today keeps other days and the current session', () => {
    const e = new EngineHarness({ start: at(2026, 3, 10, 23, 59) })
    e.input(1)
    e.input(120) // 00:01:01, split 59 s / 61 s
    const today = e.snapshot.day
    e.engine.resetToday(e.clock.now())
    expect(e.confirmedMs(today)).toBe(0)
    expectSeconds(e.confirmedMs(day(2026, 3, 10)), 59)
    expect(e.snapshot.status).toBe('active')
    expect(e.snapshot.todayTotalMs).toBe(0)
    e.input(10)
    expectSeconds(e.confirmedMs(today), 10)
  })

  it('splits durations across days without losing a millisecond', () => {
    const end = at(2026, 3, 12, 0, 30)
    const portions = TimerEngine.distribute(49 * 3_600_000, end)
    expect(portions.map(([key]) => key)).toEqual([day(2026, 3, 12), day(2026, 3, 11), day(2026, 3, 10), day(2026, 3, 9)])
    expect(portions.reduce((sum, [, ms]) => sum + ms, 0)).toBe(49 * 3_600_000)
    expect(portions[0]).toEqual([day(2026, 3, 12), 30 * 60_000])
    expect(TimerEngine.distribute(60_000, at(2026, 3, 11, 0, 0))).toEqual([[day(2026, 3, 10), 60_000]])
  })
})
