import { randomUUID } from 'node:crypto'
import { isDayKey } from '../shared/days'
import type { DayRow } from '../shared/types'

export interface SessionRecord {
  id: string
  /** Day the session started on. */
  day: string
  start: number
  end: number
  activeMs: number
}

export interface LedgerData {
  days: DayRow[]
  sessions: SessionRecord[]
}

/** Confirmed time per local day, plus recent sessions. Only confirmed time is ever stored. */
export class Ledger {
  /** Sessions are kept this long; daily totals are kept forever. */
  static readonly sessionRetentionDays = 120

  private readonly days = new Map<string, DayRow>()
  private sessionList: SessionRecord[] = []

  get sessions(): readonly SessionRecord[] {
    return this.sessionList
  }

  day(key: string): DayRow {
    const row = this.days.get(key)
    return row ? { ...row } : { day: key, activeMs: 0, sessions: 0, longestSessionMs: 0 }
  }

  activeMs(key: string): number {
    return this.days.get(key)?.activeMs ?? 0
  }

  totalActiveMs(): number {
    let total = 0
    for (const row of this.days.values()) total += row.activeMs
    return total
  }

  addActive(key: string, ms: number): void {
    if (!(ms > 0)) return
    const row = this.day(key)
    row.activeMs += ms
    this.days.set(key, row)
  }

  recordSession(day: string, start: number, end: number, activeMs: number): void {
    const row = this.day(day)
    row.sessions += 1
    row.longestSessionMs = Math.max(row.longestSessionMs, activeMs)
    this.days.set(day, row)
    this.sessionList.push({ id: randomUUID(), day, start, end, activeMs })
  }

  pruneSessions(before: string): void {
    this.sessionList = this.sessionList.filter((session) => session.day >= before)
  }

  removeDay(key: string): void {
    this.days.delete(key)
    this.sessionList = this.sessionList.filter((session) => session.day !== key)
  }

  removeAll(): void {
    this.days.clear()
    this.sessionList = []
  }

  /** Oldest first. */
  rows(): DayRow[] {
    return [...this.days.values()].map((row) => ({ ...row })).sort((a, b) => (a.day < b.day ? -1 : 1))
  }

  toJSON(): LedgerData {
    return { days: this.rows(), sessions: this.sessionList.map((session) => ({ ...session })) }
  }

  /** Accepts untrusted file contents: invalid entries are skipped, a repeated day keeps the larger total. */
  static fromJSON(data: unknown): Ledger {
    const ledger = new Ledger()
    const input = (data ?? {}) as Partial<Record<keyof LedgerData, unknown>>
    for (const raw of Array.isArray(input.days) ? input.days : []) {
      const row = raw as Partial<DayRow>
      if (!isDayKey(row.day) || !isAmount(row.activeMs)) continue
      const existing = ledger.days.get(row.day)
      if (existing && existing.activeMs >= row.activeMs) continue
      ledger.days.set(row.day, {
        day: row.day,
        activeMs: row.activeMs,
        sessions: isAmount(row.sessions) ? Math.floor(row.sessions) : 0,
        longestSessionMs: isAmount(row.longestSessionMs) ? row.longestSessionMs : 0
      })
    }
    for (const raw of Array.isArray(input.sessions) ? input.sessions : []) {
      const session = raw as Partial<SessionRecord>
      if (
        typeof session.id === 'string' &&
        isDayKey(session.day) &&
        isAmount(session.start) &&
        isAmount(session.end) &&
        isAmount(session.activeMs)
      ) {
        ledger.sessionList.push({ id: session.id, day: session.day, start: session.start, end: session.end, activeMs: session.activeMs })
      }
    }
    return ledger
  }
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
