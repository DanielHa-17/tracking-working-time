import { addDays, monthStart, weekStart } from '../shared/days'
import type { DayRow, Snapshot, Statistics } from '../shared/types'
import type { Ledger } from './ledger'

export const AVERAGE_WINDOW_DAYS = 30

/** Dashboard aggregates. Today's value is live (it includes provisional time); the rest is confirmed history. */
export function computeStatistics(ledger: Ledger, snapshot: Snapshot): Statistics {
  const today = snapshot.day
  const yesterday = addDays(today, -1)
  const week = weekStart(today)
  const month = monthStart(today)
  const averageStart = addDays(today, -(AVERAGE_WINDOW_DAYS - 1))

  const stats: Statistics = {
    todayMs: snapshot.todayTotalMs,
    yesterdayMs: 0,
    thisWeekMs: snapshot.todayTotalMs,
    thisMonthMs: snapshot.todayTotalMs,
    dailyAverageMs: 0,
    activeDaysInAverage: snapshot.todayTotalMs > 0 ? 1 : 0,
    longestSessionTodayMs: snapshot.longestSessionTodayMs
  }
  let averageTotal = snapshot.todayTotalMs
  for (const row of ledger.rows()) {
    if (row.day >= today) continue
    if (row.day === yesterday) stats.yesterdayMs = row.activeMs
    if (row.day >= week) stats.thisWeekMs += row.activeMs
    if (row.day >= month) stats.thisMonthMs += row.activeMs
    if (row.day >= averageStart && row.activeMs > 0) {
      averageTotal += row.activeMs
      stats.activeDaysInAverage += 1
    }
  }
  stats.dailyAverageMs = stats.activeDaysInAverage > 0 ? averageTotal / stats.activeDaysInAverage : 0
  return stats
}

/** Every day from the first recorded one to today, newest first, with today's live total. */
export function historyRows(ledger: Ledger, snapshot: Snapshot, minimumDays = 30): DayRow[] {
  const recorded = new Map(ledger.rows().map((row) => [row.day, row]))
  const first = ledger.rows()[0]?.day
  const rows: DayRow[] = []
  for (let day = snapshot.day, index = 0; index < 3660; day = addDays(day, -1), index += 1) {
    if (index >= minimumDays && (!first || day < first)) break
    const row = recorded.get(day) ?? { day, activeMs: 0, sessions: 0, longestSessionMs: 0 }
    rows.push(
      day === snapshot.day
        ? { day, activeMs: snapshot.todayTotalMs, sessions: snapshot.sessionsToday, longestSessionMs: snapshot.longestSessionTodayMs }
        : row
    )
  }
  return rows
}
