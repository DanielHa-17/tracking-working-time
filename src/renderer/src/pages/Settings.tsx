import { useState } from 'react'
import { formatShort, formatTimeOfDay } from '../../../shared/format'
import { MAX_THRESHOLD_MINUTES, MIN_THRESHOLD_MINUTES, THRESHOLD_PRESET_MINUTES, type Appearance, type Settings } from '../../../shared/types'
import { Icon, Row, Section, Segmented, Toggle } from '../components/controls'
import { useAppState } from '../useAppState'

type ThresholdChoice = (typeof THRESHOLD_PRESET_MINUTES)[number] | 'custom'

export function SettingsPage() {
  const state = useAppState()
  const [customChosen, setCustomChosen] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  if (!state) return null

  const { settings, snapshot, loginItem } = state
  const update = (changes: Partial<Settings>): void => void window.tracker.updateSettings(changes)
  const minutes = Math.round(settings.thresholdSeconds / 60)
  const isPreset = (THRESHOLD_PRESET_MINUTES as readonly number[]).includes(minutes)
  const choice: ThresholdChoice = customChosen || !isPreset ? 'custom' : (minutes as ThresholdChoice)

  const exportCsv = async (): Promise<void> => {
    const result = await window.tracker.exportCsv()
    if (result.saved) setNotice(`Exported to ${result.path}`)
    else if (result.error) setNotice(`Export failed: ${result.error}`)
  }

  return (
    <main className="page">
      <h1>Settings</h1>

      <Section
        title="Tracking"
        footer={
          settings.strictExclusion
            ? `Strict exclusion: when ${minutes} ${minutes === 1 ? 'minute passes' : 'minutes pass'} with no input, the entire time since your last input is removed, not just the time after the limit. The timer then waits for your next input.`
            : `Lenient: when ${minutes} ${minutes === 1 ? 'minute passes' : 'minutes pass'} with no input, the timer stops but keeps those ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
        }
      >
        <Row title="Automatic tracking" detail="Count time while you use the keyboard, mouse or trackpad.">
          <Toggle label="Automatic tracking" checked={settings.automaticTracking} onChange={(value) => update({ automaticTracking: value })} />
        </Row>
        <Row title="Inactivity limit" detail="How long without input before tracking stops.">
          <Segmented<ThresholdChoice>
            label="Inactivity limit"
            value={choice}
            options={[...THRESHOLD_PRESET_MINUTES.map((value) => ({ value, label: `${value} min` })), { value: 'custom', label: 'Custom' }]}
            onChange={(value) => {
              setCustomChosen(value === 'custom')
              if (value !== 'custom') update({ thresholdSeconds: value * 60 })
            }}
          />
        </Row>
        {choice === 'custom' && (
          <Row title="Custom limit" detail={`${MIN_THRESHOLD_MINUTES}–${MAX_THRESHOLD_MINUTES} minutes`}>
            <input
              type="number"
              className="number"
              aria-label="Custom inactivity limit in minutes"
              min={MIN_THRESHOLD_MINUTES}
              max={MAX_THRESHOLD_MINUTES}
              value={minutes}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value))
                if (value >= MIN_THRESHOLD_MINUTES && value <= MAX_THRESHOLD_MINUTES) update({ thresholdSeconds: value * 60 })
              }}
            />
            <span className="unit">min</span>
          </Row>
        )}
        <Row title="Strict exclusion" detail="Remove all unconfirmed time when the limit is reached.">
          <Toggle label="Strict exclusion" checked={settings.strictExclusion} onChange={(value) => update({ strictExclusion: value })} />
        </Row>
      </Section>

      <Section
        title="Menu Bar"
        footer={
          <span className="legend">
            <span className="dot green" /> Active <span className="dot amber" /> Idle <span className="dot grey" /> Paused, sleeping or locked
          </span>
        }
      >
        <Row title="Show timer">
          <Toggle label="Show timer" checked={settings.showTimerInMenuBar} onChange={(value) => update({ showTimerInMenuBar: value })} />
        </Row>
        <Row title="Show seconds">
          <Toggle
            label="Show seconds"
            disabled={!settings.showTimerInMenuBar}
            checked={settings.showSecondsInMenuBar}
            onChange={(value) => update({ showSecondsInMenuBar: value })}
          />
        </Row>
        <Row title="Colour icon by state">
          <Toggle label="Colour icon by state" checked={settings.showStateColor} onChange={(value) => update({ showStateColor: value })} />
        </Row>
      </Section>

      <Section title="General">
        <Row
          title="Launch at login"
          detail={
            !loginItem.supported
              ? 'Available in the installed app.'
              : loginItem.requiresApproval
                ? 'Waiting for approval in System Settings › General › Login Items.'
                : undefined
          }
        >
          {loginItem.requiresApproval && (
            <button type="button" className="link" onClick={() => void window.tracker.openLoginItemsSettings()}>
              Open Login Items
            </button>
          )}
          <Toggle
            label="Launch at login"
            disabled={!loginItem.supported}
            checked={loginItem.enabled}
            onChange={(value) => void window.tracker.setLaunchAtLogin(value)}
          />
        </Row>
        <Row title="Appearance">
          <Segmented<Appearance>
            label="Appearance"
            value={settings.appearance}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
            onChange={(value) => update({ appearance: value })}
          />
        </Row>
      </Section>

      <Section
        title="Input Detection"
        footer="Only the time since the last input is read, from the system idle clock. Keys, text, passwords, the clipboard, pointer positions, window titles and the screen are never read or stored. Nothing is sent over the network."
      >
        <Row title="Last input" detail={snapshot.inactivityMs !== null ? `${formatShort(snapshot.inactivityMs)} ago` : 'None since launch'}>
          <span className="value">{snapshot.lastInputAt ? formatTimeOfDay(snapshot.lastInputAt) : '—'}</span>
        </Row>
        <Row title="Permissions" detail="No Accessibility, Input Monitoring or Screen Recording access is needed.">
          <span className="value">
            <Icon name="shield" /> None required
          </span>
        </Row>
      </Section>

      <Section title="Data" footer={notice ?? 'History is stored only on this Mac.'}>
        <Row title="Export daily totals" detail="CSV with one row per day.">
          <button type="button" onClick={() => void exportCsv()}>
            <Icon name="export" /> Export CSV…
          </button>
        </Row>
        <Row title="Data file" detail={<span className="path">{state.dataFile}</span>}>
          <button type="button" onClick={() => void window.tracker.revealDataFile()}>
            <Icon name="folder" /> Show in Finder
          </button>
        </Row>
        <Row title="Reset all data" detail="Deletes every day of history. This cannot be undone.">
          {confirmingReset ? (
            <span className="inline-confirm">
              <button type="button" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setConfirmingReset(false)
                  void window.tracker.resetAllData().then(() => setNotice('All tracking data was deleted.'))
                }}
              >
                Delete All
              </button>
            </span>
          ) : (
            <button type="button" className="danger-outline" onClick={() => setConfirmingReset(true)}>
              Reset All Data…
            </button>
          )}
        </Row>
      </Section>
    </main>
  )
}
