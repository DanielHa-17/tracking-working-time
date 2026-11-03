import { useLayoutEffect, useRef, useState } from 'react'
import { formatClock, formatCountdown, formatDay, formatShort, formatSpoken, formatTimeOfDay } from '../../../shared/format'
import { Icon, StatTile, StatusBadge } from '../components/controls'
import { useAppState } from '../useAppState'

/** Unconfirmed time is called out once it is long enough to matter. */
const GRACE_NOTICE_MS = 15_000

export function Dashboard() {
  const state = useAppState()
  const root = useRef<HTMLDivElement>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)

  // The popover window is sized to fit this content exactly.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => window.tracker.reportContentHeight(Math.ceil(element.getBoundingClientRect().height)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [state !== null])

  if (!state) return <div ref={root} className="dashboard" />
  const { snapshot, stats, settings } = state
  const thresholdMinutes = Math.round(snapshot.thresholdMs / 60_000)
  const sessionOpen = snapshot.untilExclusionMs !== null

  return (
    <div ref={root} className="dashboard">
      <header className="dash-header">
        <StatusBadge status={snapshot.status} />
        <span className="dash-date">{formatDay(snapshot.day, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </header>

      <div className="clock" role="timer" aria-label={`Active today: ${formatSpoken(snapshot.todayTotalMs)}`}>
        {formatClock(snapshot.todayTotalMs)}
      </div>
      <div className="clock-caption">Active time today</div>

      <div className="card details">
        <div>
          <span>Session</span>
          <strong>{sessionOpen ? formatShort(snapshot.sessionMs) : '—'}</strong>
        </div>
        <div>
          <span>Last input</span>
          <strong>{snapshot.lastInputAt ? formatTimeOfDay(snapshot.lastInputAt) : '—'}</strong>
        </div>
        <div>
          <span>Inactive for</span>
          <strong>{snapshot.inactivityMs !== null ? formatShort(snapshot.inactivityMs) : '—'}</strong>
        </div>
      </div>

      {sessionOpen && snapshot.provisionalMs >= GRACE_NOTICE_MS && (
        <div className="card grace" role="status">
          <strong>Unconfirmed {formatShort(snapshot.provisionalMs)}</strong>
          <span>
            {snapshot.strictExclusion ? 'Removed' : 'Capped'} in {formatCountdown(snapshot.untilExclusionMs ?? 0)} unless you type, click or move
            the pointer.
          </span>
        </div>
      )}

      <div className="tiles">
        <StatTile label="Today" value={formatShort(stats.todayMs)} />
        <StatTile label="Yesterday" value={formatShort(stats.yesterdayMs)} />
        <StatTile label="This week" value={formatShort(stats.thisWeekMs)} />
        <StatTile label="This month" value={formatShort(stats.thisMonthMs)} />
        <StatTile label="Daily average" value={formatShort(stats.dailyAverageMs)} detail={`${stats.activeDaysInAverage} active days`} />
        <StatTile label="Longest" value={formatShort(stats.longestSessionTodayMs)} detail="session today" />
      </div>

      {snapshot.status === 'disabled' ? (
        <button type="button" className="primary" onClick={() => void window.tracker.setTrackingEnabled(true)}>
          <Icon name="power" /> Turn On Tracking
        </button>
      ) : snapshot.status === 'paused' ? (
        <button type="button" className="primary" onClick={() => void window.tracker.resume()}>
          <Icon name="play" /> Resume
        </button>
      ) : (
        <button type="button" className="primary secondary" onClick={() => void window.tracker.pause()}>
          <Icon name="pause" /> Pause
        </button>
      )}

      {confirmingReset ? (
        <div className="confirm" role="alertdialog" aria-label="Reset today">
          <span>Reset today’s time to zero?</span>
          <button type="button" onClick={() => setConfirmingReset(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirmingReset(false)
              void window.tracker.resetToday()
            }}
          >
            Reset
          </button>
        </div>
      ) : (
        <nav className="toolbar">
          <button type="button" onClick={() => void window.tracker.open('history')}>
            <Icon name="history" /> History
          </button>
          <button type="button" onClick={() => void window.tracker.open('settings')}>
            <Icon name="settings" /> Settings
          </button>
          <button type="button" aria-label="Reset today" title="Reset today" onClick={() => setConfirmingReset(true)}>
            <Icon name="reset" />
          </button>
          <button type="button" aria-label="Quit" title="Quit" onClick={() => void window.tracker.quit()}>
            <Icon name="quit" />
          </button>
        </nav>
      )}

      <p className="footnote">
        {settings.automaticTracking ? (
          snapshot.strictExclusion ? (
            <>
              Counts while you use the keyboard, mouse or trackpad. After {thresholdMinutes} {thresholdMinutes === 1 ? 'minute' : 'minutes'} with no input,
              the time since your last input is removed and the timer stops until you return.
            </>
          ) : (
            <>
              Counts while you use the keyboard, mouse or trackpad. After {thresholdMinutes} {thresholdMinutes === 1 ? 'minute' : 'minutes'} with no input,
              the timer stops and keeps those minutes.
            </>
          )
        ) : (
          <>Automatic tracking is off. Nothing is counted until you turn it on.</>
        )}
      </p>
    </div>
  )
}
