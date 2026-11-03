// Types shared by the main process, the preload bridge and the React UI.
// All durations are milliseconds; all dates are epoch milliseconds.

export type SuspendReason = 'systemSleep' | 'screenLocked' | 'sessionInactive'
export type TrackingStatus = 'active' | 'idle' | 'paused' | 'disabled' | SuspendReason
export type Indicator = 'green' | 'amber' | 'grey'

export const STATUS_TITLE: Record<TrackingStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  paused: 'Paused',
  disabled: 'Tracking Off',
  systemSleep: 'Sleeping',
  screenLocked: 'Locked',
  sessionInactive: 'Switched Out'
}

export function indicatorFor(status: TrackingStatus): Indicator {
  if (status === 'active') return 'green'
  if (status === 'idle') return 'amber'
  return 'grey'
}

/** Everything the UI needs to know at one moment. */
export interface Snapshot {
  status: TrackingStatus
  /** Local calendar day, "YYYY-MM-DD". */
  day: string
  /** What the menu bar shows: confirmed time today plus the provisional time falling in today. */
  todayTotalMs: number
  todayConfirmedMs: number
  /** Unconfirmed time since the last input. Zero unless a session is open. */
  provisionalMs: number
  /** Current session including provisional time. Zero when no session is open. */
  sessionMs: number
  sessionStart: number | null
  sessionsToday: number
  longestSessionTodayMs: number
  lastInputAt: number | null
  /** Time since the last observed input, whether or not it counted. */
  inactivityMs: number | null
  /** Time left before the provisional interval is excluded. Null when no session is open. */
  untilExclusionMs: number | null
  thresholdMs: number
  strictExclusion: boolean
}

export interface Statistics {
  todayMs: number
  yesterdayMs: number
  thisWeekMs: number
  thisMonthMs: number
  /** Mean over days with any activity in the last 30 days, today included. */
  dailyAverageMs: number
  activeDaysInAverage: number
  longestSessionTodayMs: number
}

export type Appearance = 'system' | 'light' | 'dark'

export interface Settings {
  automaticTracking: boolean
  thresholdSeconds: number
  strictExclusion: boolean
  showTimerInMenuBar: boolean
  showSecondsInMenuBar: boolean
  showStateColor: boolean
  appearance: Appearance
}

export const DEFAULT_SETTINGS: Settings = {
  automaticTracking: true,
  thresholdSeconds: 300,
  strictExclusion: true,
  showTimerInMenuBar: true,
  showSecondsInMenuBar: true,
  showStateColor: true,
  appearance: 'system'
}

export const THRESHOLD_PRESET_MINUTES = [1, 3, 5, 10] as const
export const MIN_THRESHOLD_MINUTES = 1
export const MAX_THRESHOLD_MINUTES = 240

export interface LoginItemState {
  /** False in development builds, where the login item would point at Electron itself. */
  supported: boolean
  enabled: boolean
  requiresApproval: boolean
}

export interface AppState {
  snapshot: Snapshot
  stats: Statistics
  settings: Settings
  loginItem: LoginItemState
  dataFile: string
}

export interface DayRow {
  day: string
  activeMs: number
  sessions: number
  longestSessionMs: number
}

export interface ExportResult {
  saved: boolean
  path?: string
  error?: string
}

export type View = 'dashboard' | 'settings' | 'history'

/** The only functions the UI can call. Exposed by the preload script as `window.tracker`. */
export interface TrackerApi {
  getState(): Promise<AppState>
  onState(listener: (state: AppState) => void): () => void
  getHistory(): Promise<DayRow[]>
  pause(): Promise<void>
  resume(): Promise<void>
  setTrackingEnabled(enabled: boolean): Promise<void>
  resetToday(): Promise<void>
  resetAllData(): Promise<void>
  updateSettings(changes: Partial<Settings>): Promise<void>
  setLaunchAtLogin(enabled: boolean): Promise<void>
  openLoginItemsSettings(): Promise<void>
  exportCsv(): Promise<ExportResult>
  revealDataFile(): Promise<void>
  open(view: 'settings' | 'history'): Promise<void>
  closePopover(): Promise<void>
  quit(): Promise<void>
  reportContentHeight(height: number): void
}
