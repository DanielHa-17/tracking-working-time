const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`)

const wholeSeconds = (ms: number): number => Math.floor(Math.max(0, ms) / 1000)

/** "03:42:18", or "03:42" without seconds. Truncates, so the display never runs ahead of the total. */
export function formatClock(ms: number, showSeconds = true): string {
  const total = wholeSeconds(ms)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return showSeconds ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}`
}

/** "2h 05m", "4m 12s", "38s". */
export function formatShort(ms: number): string {
  const total = wholeSeconds(ms)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${pad(minutes)}m`
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`
  return `${seconds}s`
}

/** "4:59" countdown. Rounds up, so it reaches 0:00 only when the time is really up. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** Spoken form for screen readers, e.g. "3 hours 42 minutes". */
export function formatSpoken(ms: number): string {
  const total = wholeSeconds(ms)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  if (seconds || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`)
  return parts.join(' ')
}

export function formatTimeOfDay(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

/** "Mon, 2 Nov" style label for a "YYYY-MM-DD" key. */
export function formatDay(key: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, options)
}

export function toCsv(rows: { day: string; activeMs: number; sessions: number; longestSessionMs: number }[]): string {
  const lines = ['date,active_seconds,active_time,sessions,longest_session_seconds,longest_session']
  for (const row of rows) {
    lines.push(
      [row.day, wholeSeconds(row.activeMs), formatClock(row.activeMs), row.sessions, wholeSeconds(row.longestSessionMs), formatClock(row.longestSessionMs)].join(',')
    )
  }
  return `${lines.join('\n')}\n`
}
