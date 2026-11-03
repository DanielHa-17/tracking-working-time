import { afterEach, describe, expect, it } from 'vitest'
import type { ControllerUpdate } from '../src/main/controller'
import { FileLedgerStore } from '../src/main/persistence'
import { at, day, expectSeconds, Harness, random } from './support'

// The full app logic with the idle clock reporting whole seconds, as Electron does on macOS.
let harnesses: Harness[] = []
function harness(options?: ConstructorParameters<typeof Harness>[0]): Harness {
  const h = new Harness(options)
  harnesses.push(h)
  return h
}
afterEach(() => {
  for (const h of harnesses) h.tearDown()
  harnesses = []
})

describe('keyboard, mouse and trackpad activity', () => {
  it('the first input starts the timer and the next one confirms the interval', () => {
    const h = harness()
    expect(h.status).toBe('idle')
    expect(h.displayed).toBe(0)

    h.press()
    expect(h.status).toBe('active')
    h.wait(10)
    expectSeconds(h.snapshot.todayTotalMs, 10, 0.2)
    expect(h.confirmedMs(), 'time after the last input stays provisional').toBe(0)

    h.press()
    expectSeconds(h.confirmedMs(), 10.1)
  })

  it('steady activity of any kind keeps one session running', () => {
    const h = harness()
    h.press()
    for (let minute = 0; minute < 30; minute += 1) {
      h.wait(60)
      expect(h.status).toBe('active')
      h.input.touch()
    }
    h.wait(1)
    expectSeconds(h.confirmedMs(), 1800, 1)
    expect(h.snapshot.sessionsToday).toBe(1)
  })

  it('polling the same reading many times counts it once', () => {
    const h = harness()
    h.press()
    for (let index = 0; index < 50; index += 1) h.controller.tick()
    h.wait(5)
    h.press()
    for (let index = 0; index < 50; index += 1) h.controller.tick()
    expectSeconds(h.confirmedMs(), 5.1)
  })
})

describe('five-minute rule with whole-second idle readings', () => {
  it('an input 299.9 s after the last one never rolls back; 301 s always does', () => {
    const next = random(7)
    for (let run = 0; run < 40; run += 1) {
      for (const gap of [120, 299, 299.9, 301.1, 450]) {
        const h = harness()
        h.wait(next() * 2) // vary the phase between input and polling
        h.press()
        h.wait(gap - 0.1)
        h.press()
        if (gap < 300) {
          expect(h.status).toBe('active')
          expect(h.snapshot.sessionsToday, `gap ${gap}`).toBe(1)
          expectSeconds(h.confirmedMs(), gap, 1)
        } else {
          expect(h.confirmedMs(), `gap ${gap}`).toBe(0)
          expect(h.status, 'the new input starts a fresh session').toBe('active')
        }
        h.tearDown()
        harnesses = harnesses.filter((other) => other !== h)
      }
    }
  })

  it('random bursts of input with every gap under 299.9 s keep one unbroken session', () => {
    const next = random(99)
    const h = harness()
    h.press()
    for (let step = 0; step < 400; step += 1) {
      const kind = next()
      if (kind < 0.6) h.wait(next() * 1.5) // typing or scrolling: inputs well under a second apart
      else if (kind < 0.9) h.wait(next() * 60)
      else h.wait(290 + next() * 9.8) // long pauses just under the threshold
      h.input.touch()
    }
    h.wait(0.2)
    expect(h.status).toBe('active')
    expect(h.snapshot.sessionsToday).toBe(1)
  })

  it('returning after fifteen minutes does not count them and resumes from the corrected total', () => {
    const h = harness()
    h.press()
    h.wait(119.9)
    h.press()
    expectSeconds(h.confirmedMs(), 120)

    h.wait(15 * 60)
    expect(h.status).toBe('idle')
    expectSeconds(h.snapshot.todayTotalMs, 120)

    h.press()
    expect(h.status, 'returns to Active immediately').toBe('active')
    expectSeconds(h.confirmedMs(), 120)
    h.wait(59.9)
    h.press()
    expectSeconds(h.confirmedMs(), 180)
    expect(h.snapshot.sessionsToday).toBe(2)
  })

  it('the menu bar shows the countdown as soon as input stops', () => {
    const h = harness()
    h.press()
    h.wait(60)
    expectSeconds(h.snapshot.untilExclusionMs ?? -1, 240, 1)
  })

  it('a shorter threshold applies to inactivity already in progress', () => {
    const h = harness()
    h.press()
    h.wait(30)
    h.press()
    h.wait(90)
    h.controller.applySettings({ ...h.settings, thresholdSeconds: 60 })
    expect(h.status).toBe('idle')
    expectSeconds(h.confirmedMs(), 30.1)
  })

  it('lenient mode keeps the grace period instead of rolling it back', () => {
    const h = harness({ settings: { strictExclusion: false } })
    h.press()
    h.wait(400)
    expect(h.status).toBe('idle')
    expectSeconds(h.confirmedMs(), 300, 0.2)
  })
})

describe('pause and automatic tracking', () => {
  it('a manual pause cannot be overridden by input', () => {
    const h = harness()
    h.press()
    h.wait(29.9)
    h.press()
    h.controller.pause()
    expect(h.status).toBe('paused')
    expectSeconds(h.snapshot.todayTotalMs, 30)
    for (let index = 0; index < 5; index += 1) {
      h.press()
      h.wait(10)
      expect(h.status).toBe('paused')
    }
    h.wait(600)
    expectSeconds(h.snapshot.todayTotalMs, 30)

    h.controller.resume()
    expect(h.status).toBe('active')
    h.wait(9.9)
    h.press()
    expectSeconds(h.confirmedMs(), 40)
  })

  it('turning automatic tracking off stops counting until it is turned on again', () => {
    const h = harness()
    h.press()
    h.wait(5)
    h.controller.applySettings({ ...h.settings, automaticTracking: false })
    expect(h.status).toBe('disabled')
    h.press()
    h.wait(30)
    expect(h.status).toBe('disabled')
    expect(h.confirmedMs()).toBe(0)
    h.controller.applySettings({ ...h.settings, automaticTracking: true })
    expect(h.status).toBe('active')
  })
})

describe('sleep, lock and user switching', () => {
  it('system sleep does not count, and tracking waits for input after wake', () => {
    const h = harness()
    h.press()
    h.wait(59.9)
    h.press()
    h.wait(20)
    h.emit('suspend')
    expect(h.status).toBe('systemSleep')
    expectSeconds(h.snapshot.todayTotalMs, 60)

    h.clock.sleep(3600)
    h.emit('resume')
    expect(h.status).toBe('idle')
    h.wait(5)
    expectSeconds(h.snapshot.todayTotalMs, 60)

    h.press()
    h.wait(29.9)
    h.press()
    expectSeconds(h.confirmedMs(), 90)
  })

  it('a sleep without a notification is detected from the clocks', () => {
    const h = harness()
    h.press()
    h.wait(29.9)
    h.press()
    h.wait(2)
    h.clock.sleep(120) // no notification arrives
    h.press()
    expectSeconds(h.confirmedMs(), 30)
    expect(h.status).toBe('active')
    expect(h.snapshot.sessionsToday).toBe(2)
    h.wait(9.9)
    h.press()
    expectSeconds(h.confirmedMs(), 40)
  })

  it('the lock screen does not count, including the password being typed', () => {
    const h = harness()
    h.press()
    h.wait(59.9)
    h.press()
    h.input.locked = true
    h.emit('lock-screen')
    expect(h.status).toBe('screenLocked')
    h.wait(200)
    for (let index = 0; index < 8; index += 1) h.press()
    expect(h.status).toBe('screenLocked')
    expectSeconds(h.snapshot.todayTotalMs, 60)

    h.input.locked = false
    h.emit('unlock-screen')
    expect(h.status).toBe('idle')
    h.wait(1)
    h.press()
    expect(h.status).toBe('active')
    h.wait(19.9)
    h.press()
    expectSeconds(h.confirmedMs(), 80)
  })

  it('a missed lock notification is caught when input appears', () => {
    const h = harness()
    h.press()
    h.wait(59.9)
    h.press()
    h.wait(30)
    h.input.locked = true // locked, but no notification
    h.wait(100)
    h.press() // password keystroke
    expect(h.status).toBe('screenLocked')
    expectSeconds(h.confirmedMs(), 60)

    h.input.locked = false
    h.wait(2)
    h.press() // first input after unlock ends the suspension but does not count
    expect(h.status).toBe('idle')
    h.wait(1)
    h.press()
    expect(h.status).toBe('active')
    h.wait(9.9)
    h.press()
    expectSeconds(h.confirmedMs(), 70)
  })

  it('launching while the screen is locked starts suspended', () => {
    const h = harness()
    h.input.locked = true
    h.relaunch(60)
    expect(h.status).toBe('screenLocked')
    h.press()
    expect(h.status).toBe('screenLocked')
    h.input.locked = false // unlocked; the missed notification is caught on the next input
    h.wait(2)
    h.press()
    expect(h.status).toBe('idle')
    h.wait(1)
    h.press()
    expect(h.status).toBe('active')
    expect(h.confirmedMs()).toBe(0)
  })

  it('fast user switching suspends tracking', () => {
    const h = harness()
    h.press()
    h.wait(10)
    h.emit('user-did-resign-active')
    expect(h.status).toBe('sessionInactive')
    h.wait(600)
    h.emit('user-did-become-active')
    expect(h.status).toBe('idle')
    expect(h.confirmedMs()).toBe(0)
  })

  it('overlapping suspensions resume only when all have ended', () => {
    const h = harness()
    h.emit('lock-screen')
    h.emit('suspend')
    expect(h.status).toBe('systemSleep')
    h.emit('resume')
    expect(h.status, 'still locked after wake').toBe('screenLocked')
    h.emit('unlock-screen')
    expect(h.status).toBe('idle')
  })

  it('a manual pause survives sleep and wake', () => {
    const h = harness()
    h.controller.pause()
    h.emit('suspend')
    h.clock.sleep(600)
    h.emit('resume')
    h.press()
    expect(h.status).toBe('paused')
  })

  it('a shutdown notice saves confirmed time but keeps tracking in case it is cancelled', () => {
    const h = harness()
    h.press()
    h.wait(9.9)
    h.press()
    h.emit('shutdown')
    expect(new FileLedgerStore(h.directory).load().activeMs(h.snapshot.day)).toBe(10_000)
    h.wait(1)
    h.press()
    expect(h.status).toBe('active')
  })
})

describe('restarting, saving and days', () => {
  it('a relaunch restores confirmed time without inventing activity', () => {
    const h = harness()
    h.press()
    for (let index = 0; index < 20; index += 1) {
      h.wait(30)
      h.input.touch()
    }
    h.wait(10) // provisional time is pending when the app quits
    const confirmed = h.confirmedMs()
    expectSeconds(confirmed, 600, 1)

    h.relaunch(3600)
    expect(h.status).toBe('idle')
    expect(h.snapshot.todayTotalMs).toBe(confirmed)
    h.wait(30) // the last input before the relaunch is still visible to the idle clock
    expect(h.status).toBe('idle')
    expect(h.snapshot.todayTotalMs).toBe(confirmed)

    h.press()
    h.wait(9.9)
    h.press()
    expectSeconds(h.confirmedMs(), confirmed / 1000 + 10)
  })

  it('quitting writes confirmed time to disk', () => {
    const h = harness()
    h.press()
    h.wait(4.9)
    h.press()
    const today = h.snapshot.day
    h.controller.shutdown()
    expect(new FileLedgerStore(h.directory).load().activeMs(today)).toBe(5000)
    expect(h.logs.at(-1)).toBe('Stopped: today 00:00:05 confirmed and saved')
  })

  it('saves at once when a session ends but not every second while tracking', () => {
    const h = harness()
    const before = h.store.saveCount
    h.press()
    for (let index = 0; index < 30; index += 1) {
      h.wait(10)
      h.input.touch()
    }
    expect(h.store.saveCount - before, 'about once a minute').toBeLessThanOrEqual(6)

    h.wait(250)
    const beforeExpiry = h.store.saveCount
    const confirmed = h.confirmedMs()
    h.wait(52)
    expect(h.status).toBe('idle')
    expect(h.store.saveCount).toBe(beforeExpiry + 1)
    expect(new FileLedgerStore(h.directory).load().activeMs(h.snapshot.day)).toBe(confirmed)
  })

  it('moves to the new day at midnight even while paused', () => {
    const h = harness({ start: at(2026, 3, 10, 23, 59, 50) })
    h.press()
    h.wait(4.9)
    h.press()
    h.controller.pause()
    h.wait(60)
    expect(h.snapshot.day).toBe(day(2026, 3, 11))
    expect(h.snapshot.todayTotalMs).toBe(0)
    expectSeconds(h.confirmedMs(day(2026, 3, 10)), 5)
  })

  it('every window sees the same single engine', () => {
    const h = harness()
    const windows: ControllerUpdate[][] = [[], [], []]
    for (const window of windows) h.controller.on('update', (update: ControllerUpdate) => window.push(update))

    h.press()
    h.wait(30)
    h.press()
    const reading = h.snapshot
    for (let index = 0; index < 20; index += 1) h.controller.tick()
    expect(h.snapshot).toEqual(reading)

    h.wait(300)
    expect(h.status).toBe('idle')
    expect(h.controller.ledger.day(reading.day).sessions).toBe(1)
    expect(h.controller.ledger.sessions).toHaveLength(1)
    for (const window of windows) expect(window.at(-1)).toEqual(windows[0].at(-1))
  })
})
