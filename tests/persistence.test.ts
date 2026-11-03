import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Ledger } from '../src/main/ledger'
import { FileLedgerStore, sanitizeSettings, SettingsStore } from '../src/main/persistence'
import { historyRows } from '../src/main/statistics'
import { formatClock, formatCountdown, formatShort, formatSpoken, toCsv } from '../src/shared/format'
import { addDays, isDayKey, weekStart } from '../src/shared/days'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { day, EngineHarness } from './support'

const directories: string[] = []
function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'twt-store-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('saved history', () => {
  it('round-trips through disk', () => {
    const store = new FileLedgerStore(temporaryDirectory())
    const ledger = new Ledger()
    ledger.addActive(day(2026, 3, 10), 3_723_000)
    ledger.recordSession(day(2026, 3, 10), 1, 2, 3_000_000)
    store.save(ledger)
    const loaded = store.load()
    expect(loaded.toJSON()).toEqual(ledger.toJSON())
    expect((fs.statSync(store.file).mode & 0o777).toString(8), 'readable only by the user').toBe('600')
  })

  it('starts empty when there is no file yet', () => {
    expect(new FileLedgerStore(temporaryDirectory()).load().rows()).toEqual([])
  })

  it('moves a corrupt file aside and starts fresh', () => {
    const directory = temporaryDirectory()
    fs.writeFileSync(path.join(directory, 'activity.json'), '{ not json')
    const store = new FileLedgerStore(directory)
    expect(store.load().rows()).toEqual([])
    expect(store.recoveredBackup).not.toBeNull()
    expect(fs.readFileSync(store.recoveredBackup!, 'utf8')).toBe('{ not json')
  })

  it('skips invalid entries and never counts a repeated day twice', () => {
    const ledger = Ledger.fromJSON({
      days: [
        { day: '2026-03-10', activeMs: 5000, sessions: 1, longestSessionMs: 5000 },
        { day: '2026-03-10', activeMs: 9000, sessions: 2, longestSessionMs: 6000 },
        { day: '2026-02-31', activeMs: 1000 },
        { day: '2026-03-11', activeMs: -4 },
        { day: '2026-03-12', activeMs: 'lots' },
        'garbage'
      ],
      sessions: [{ id: 'x', day: '2026-03-10', start: 1, end: 2, activeMs: 3 }, { id: 5 }]
    })
    expect(ledger.rows()).toEqual([{ day: '2026-03-10', activeMs: 9000, sessions: 2, longestSessionMs: 6000 }])
    expect(ledger.sessions).toHaveLength(1)
  })

  it('keeps daily totals forever but prunes sessions after 120 days', () => {
    const e = new EngineHarness()
    for (let index = 0; index < 130; index += 1) {
      e.input(1)
      e.input(30)
      e.wait(86_400 - 31)
    }
    expect(e.engine.ledger.rows()).toHaveLength(130)
    expect(e.engine.ledger.sessions.length).toBeLessThanOrEqual(121)
  })

  it('exports one CSV row per day', () => {
    expect(toCsv([{ day: '2026-03-10', activeMs: 13_338_400, sessions: 5, longestSessionMs: 2_400_000 }])).toBe(
      'date,active_seconds,active_time,sessions,longest_session_seconds,longest_session\n2026-03-10,13338,03:42:18,5,2400,00:40:00\n'
    )
  })

  it('lists every day from the first recorded one, with today live', () => {
    const e = new EngineHarness()
    e.engine.ledger.addActive(addDays(e.snapshot.day, -40), 60_000)
    e.input(1)
    e.wait(10)
    const rows = historyRows(e.engine.ledger, e.snapshot)
    expect(rows).toHaveLength(41)
    expect(rows[0].day).toBe(e.snapshot.day)
    expect(rows[0].activeMs).toBe(10_000)
    expect(rows.at(-1)!.activeMs).toBe(60_000)
  })
})

describe('settings', () => {
  it('fills gaps and clamps invalid values', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ thresholdSeconds: 5, appearance: 'neon', strictExclusion: 'yes' })).toEqual({
      ...DEFAULT_SETTINGS,
      thresholdSeconds: 60
    })
    expect(sanitizeSettings({ thresholdSeconds: 1e9 }).thresholdSeconds).toBe(240 * 60)
  })

  it('persists changes', () => {
    const directory = temporaryDirectory()
    new SettingsStore(directory).update({ thresholdSeconds: 180, appearance: 'dark' })
    const reloaded = new SettingsStore(directory)
    expect(reloaded.settings).toMatchObject({ thresholdSeconds: 180, appearance: 'dark' })
    expect(reloaded.welcomeShown).toBe(false)
    reloaded.markWelcomeShown()
    expect(new SettingsStore(directory).welcomeShown).toBe(true)
  })
})

describe('formatting and days', () => {
  it('formats durations', () => {
    expect(formatClock(3 * 3_600_000 + 42 * 60_000 + 18_999)).toBe('03:42:18')
    expect(formatClock(3 * 3_600_000 + 42 * 60_000, false)).toBe('03:42')
    expect(formatClock(-5)).toBe('00:00:00')
    expect(formatShort(125 * 60_000)).toBe('2h 05m')
    expect(formatShort(252_000)).toBe('4m 12s')
    expect(formatCountdown(299_001)).toBe('5:00')
    expect(formatSpoken(3 * 3_600_000 + 60_000)).toBe('3 hours 1 minute')
  })

  it('validates and walks calendar days', () => {
    expect(isDayKey('2026-02-29')).toBe(false)
    expect(isDayKey('2028-02-29')).toBe(true)
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30') // across the DST change
    expect(weekStart('2026-03-15')).toBe('2026-03-09') // Sunday belongs to the week starting Monday
  })
})
