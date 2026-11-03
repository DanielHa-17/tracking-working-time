// Local calendar days as "YYYY-MM-DD" strings. They sort chronologically as plain strings.

const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`)

export function dayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parts(key: string): [number, number, number] {
  const [year, month, day] = key.split('-').map(Number)
  return [year, month, day]
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = parts(value)
  return dayKey(new Date(year, month - 1, day, 12).getTime()) === value
}

/** Local start of the day. Where DST skips midnight, JavaScript returns the first valid time. */
export function dayStart(key: string): number {
  const [year, month, day] = parts(key)
  return new Date(year, month - 1, day).getTime()
}

export function startOfDay(time: number): number {
  return dayStart(dayKey(time))
}

export function addDays(key: string, days: number): string {
  const [year, month, day] = parts(key)
  return dayKey(new Date(year, month - 1, day + days, 12).getTime())
}

/** Monday that starts the week containing the day. */
export function weekStart(key: string): string {
  const [year, month, day] = parts(key)
  const weekday = new Date(year, month - 1, day, 12).getDay() // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7))
}

export function monthStart(key: string): string {
  return `${key.slice(0, 8)}01`
}
