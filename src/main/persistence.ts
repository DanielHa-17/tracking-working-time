import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, MAX_THRESHOLD_MINUTES, MIN_THRESHOLD_MINUTES, type Settings } from '../shared/types'
import { Ledger } from './ledger'

export interface LedgerStore {
  readonly file: string
  load(): Ledger
  save(ledger: Ledger): void
}

/** Writes to a temporary file first, so a crash or power loss never leaves a half-written file. */
export function writeFileAtomically(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, file)
}

/** Confirmed history as JSON in the app's own data folder. */
export class FileLedgerStore implements LedgerStore {
  static readonly version = 1
  readonly file: string
  /** Set when an unreadable file was moved aside at load. */
  recoveredBackup: string | null = null
  saveCount = 0

  constructor(directory: string) {
    this.file = path.join(directory, 'activity.json')
  }

  load(): Ledger {
    let text: string
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch {
      return new Ledger()
    }
    try {
      const data = JSON.parse(text) as { version?: unknown; ledger?: unknown }
      if (data.version !== FileLedgerStore.version || typeof data.ledger !== 'object') throw new Error('unsupported format')
      return Ledger.fromJSON(data.ledger)
    } catch {
      // Keep the unreadable file for inspection and start fresh rather than refusing to run.
      const backup = path.join(path.dirname(this.file), `activity.corrupt-${Date.now()}.json`)
      fs.renameSync(this.file, backup)
      this.recoveredBackup = backup
      return new Ledger()
    }
  }

  save(ledger: Ledger): void {
    const data = { version: FileLedgerStore.version, savedAt: new Date().toISOString(), ledger: ledger.toJSON() }
    writeFileAtomically(this.file, `${JSON.stringify(data, null, 2)}\n`)
    this.saveCount += 1
  }
}

/** Fills gaps and drops invalid values, so a hand-edited or old settings file cannot break the app. */
export function sanitizeSettings(input: unknown): Settings {
  const raw = (input ?? {}) as Partial<Record<keyof Settings, unknown>>
  const bool = (key: keyof Settings): boolean => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean))
  const seconds = typeof raw.thresholdSeconds === 'number' && Number.isFinite(raw.thresholdSeconds) ? raw.thresholdSeconds : DEFAULT_SETTINGS.thresholdSeconds
  const appearance = raw.appearance === 'light' || raw.appearance === 'dark' || raw.appearance === 'system' ? raw.appearance : DEFAULT_SETTINGS.appearance
  return {
    automaticTracking: bool('automaticTracking'),
    thresholdSeconds: Math.round(Math.min(MAX_THRESHOLD_MINUTES * 60, Math.max(MIN_THRESHOLD_MINUTES * 60, seconds))),
    strictExclusion: bool('strictExclusion'),
    showTimerInMenuBar: bool('showTimerInMenuBar'),
    showSecondsInMenuBar: bool('showSecondsInMenuBar'),
    showStateColor: bool('showStateColor'),
    appearance
  }
}

export class SettingsStore {
  readonly file: string
  private current: Settings
  /** Remembers that the first-launch dashboard was shown. */
  private flags: { welcomeShown: boolean }

  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json')
    let data: { settings?: unknown; welcomeShown?: unknown } = {}
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      // Missing or unreadable: defaults.
    }
    this.current = sanitizeSettings(data.settings)
    this.flags = { welcomeShown: data.welcomeShown === true }
  }

  get settings(): Settings {
    return { ...this.current }
  }

  get welcomeShown(): boolean {
    return this.flags.welcomeShown
  }

  update(changes: Partial<Settings>): Settings {
    this.current = sanitizeSettings({ ...this.current, ...changes })
    this.write()
    return this.settings
  }

  markWelcomeShown(): void {
    this.flags.welcomeShown = true
    this.write()
  }

  private write(): void {
    writeFileAtomically(this.file, `${JSON.stringify({ settings: this.current, ...this.flags }, null, 2)}\n`)
  }
}
