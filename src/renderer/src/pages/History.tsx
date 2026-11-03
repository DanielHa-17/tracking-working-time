import { useEffect, useState } from 'react'
import { formatClock, formatDay, formatShort } from '../../../shared/format'
import type { DayRow } from '../../../shared/types'
import { Segmented, StatTile } from '../components/controls'
import { useAppState } from '../useAppState'

type Range = 7 | 30

function niceCeiling(ms: number): number {
  const hours = ms / 3_600_000
  const steps = [0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 24]
  return (steps.find((step) => step >= hours) ?? Math.ceil(hours)) * 3_600_000
}

function BarChart({ rows, range }: { rows: DayRow[]; range: Range }) {
  const days = [...rows].reverse() // oldest first, left to right
  const width = 680
  const height = 220
  const top = 22
  const bottom = 26
  const left = 36
  const plotHeight = height - top - bottom
  const max = niceCeiling(Math.max(...days.map((day) => day.activeMs), 1))
  const slot = (width - left) / days.length
  const barWidth = Math.min(48, slot * 0.62)
  const ticks = [0, 0.5, 1].map((fraction) => fraction * max)

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Active time for the last ${range} days`}>
      {ticks.map((tick) => {
        const y = top + plotHeight - (tick / max) * plotHeight
        return (
          <g key={tick}>
            <line x1={left} x2={width} y1={y} y2={y} className="gridline" />
            <text x={left - 6} y={y + 4} className="axis" textAnchor="end">
              {tick === 0 ? '0' : `${+(tick / 3_600_000).toFixed(1)}h`}
            </text>
          </g>
        )
      })}
      {days.map((day, index) => {
        const barHeight = (day.activeMs / max) * plotHeight
        const x = left + index * slot + (slot - barWidth) / 2
        const y = top + plotHeight - barHeight
        const isToday = index === days.length - 1
        const showLabel = range === 7 || index % 5 === (days.length - 1) % 5
        return (
          <g key={day.day}>
            <title>{`${formatDay(day.day)}: ${formatClock(day.activeMs)}`}</title>
            {day.activeMs > 0 && <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 2)} rx={Math.min(5, barWidth / 4)} className={isToday ? 'bar today' : 'bar'} />}
            {range === 7 && day.activeMs > 0 && (
              <text x={x + barWidth / 2} y={y - 6} className="bar-value" textAnchor="middle">
                {formatShort(day.activeMs)}
              </text>
            )}
            {showLabel && (
              <text x={x + barWidth / 2} y={height - 8} className="axis" textAnchor="middle">
                {formatDay(day.day, range === 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function History() {
  const state = useAppState()
  const [range, setRange] = useState<Range>(7)
  const [rows, setRows] = useState<DayRow[]>([])
  const todayTotal = state ? Math.floor(state.snapshot.todayTotalMs / 1000) : 0

  // Today's bar follows the live total; past days only change on a reset.
  useEffect(() => {
    void window.tracker.getHistory().then(setRows)
  }, [todayTotal, state?.snapshot.day])

  const recent = rows.slice(0, range)
  const total = recent.reduce((sum, row) => sum + row.activeMs, 0)
  const activeDays = recent.filter((row) => row.activeMs > 0)
  const best = activeDays.reduce<DayRow | null>((top, row) => (!top || row.activeMs > top.activeMs ? row : top), null)

  return (
    <main className="page history">
      <div className="page-header">
        <h1>History</h1>
        <Segmented<Range>
          label="Range"
          value={range}
          options={[
            { value: 7, label: '7 days' },
            { value: 30, label: '30 days' }
          ]}
          onChange={setRange}
        />
      </div>

      <div className="tiles three">
        <StatTile label={`Last ${range} days`} value={formatShort(total)} />
        <StatTile label="Average per active day" value={formatShort(activeDays.length ? total / activeDays.length : 0)} detail={`${activeDays.length} active days`} />
        <StatTile label="Best day" value={best ? formatShort(best.activeMs) : '—'} detail={best ? formatDay(best.day) : undefined} />
      </div>

      <div className="card chart-card">{recent.length > 0 && <BarChart rows={recent} range={range} />}</div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="numeric">Active time</th>
              <th className="numeric">Sessions</th>
              <th className="numeric">Longest session</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.day} className={row.activeMs === 0 ? 'empty' : undefined}>
                <td>{formatDay(row.day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td className="numeric">{formatClock(row.activeMs)}</td>
                <td className="numeric">{row.sessions}</td>
                <td className="numeric">{formatClock(row.longestSessionMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">Only confirmed time is stored. Today includes time that is still unconfirmed.</p>
    </main>
  )
}
