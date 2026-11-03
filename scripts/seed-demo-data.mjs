// Writes plausible sample history for screenshots: node scripts/seed-demo-data.mjs <directory>
import fs from 'node:fs'
import path from 'node:path'

const directory = process.argv[2]
if (!directory) throw new Error('Usage: node scripts/seed-demo-data.mjs <directory>')
const pad = (n) => String(n).padStart(2, '0')
const key = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

let seed = 7
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const days = []
for (let offset = 45; offset >= 1; offset -= 1) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  const weekend = date.getDay() === 0 || date.getDay() === 6
  if (weekend && random() < 0.7) continue
  const hours = weekend ? 0.5 + random() * 2 : 3.5 + random() * 4.5
  const activeMs = Math.round(hours * 3_600_000)
  const sessions = 2 + Math.floor(random() * 6)
  days.push({ day: key(date), activeMs, sessions, longestSessionMs: Math.round(activeMs / (1.5 + random() * 2)) })
}
const file = path.join(directory, 'data', 'activity.json')
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ledger: { days, sessions: [] } }, null, 2))
fs.writeFileSync(path.join(directory, 'data', 'settings.json'), JSON.stringify({ settings: {}, welcomeShown: true }))
console.log(`Wrote ${days.length} days to ${file}`)
