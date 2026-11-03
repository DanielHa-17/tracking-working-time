import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, powerMonitor, shell } from 'electron'
import { dayKey } from '../shared/days'
import { toCsv } from '../shared/format'
import { DEFAULT_SETTINGS, type AppState, type ExportResult, type LoginItemState, type Settings } from '../shared/types'
import type { IdleReader } from './activityMonitor'
import { timerScheduler, TrackingController, type ControllerUpdate } from './controller'
import { loginItemState, openLoginItemsSettings, setLaunchAtLogin } from './loginItem'
import { FileLedgerStore, SettingsStore } from './persistence'
import { captureScreens } from './screenshots'
import { hardenApp, isTrustedSender } from './security'
import { systemTime } from './time'
import { TrayView } from './trayView'
import { WindowManager } from './windows'

// Development only: `--screenshots=<dir>` renders every screen with the data in <dir>/data.
const screenshotDirectory = app.isPackaged ? undefined : process.argv.find((arg) => arg.startsWith('--screenshots='))?.split('=')[1]
if (screenshotDirectory) app.setPath('userData', path.resolve(screenshotDirectory, 'data'))

if (process.argv.includes('--diagnostics')) {
  // Prints what the app can see of the system, then quits. Safe to run next to the running app.
  void app.whenReady().then(() => {
    console.log(JSON.stringify({ idleSeconds: powerMonitor.getSystemIdleTime(), idleState: powerMonitor.getSystemIdleState(1) }))
    app.exit(0)
  })
} else if (!app.requestSingleInstanceLock()) {
  // One copy only: a second one would start a second, duplicate tracking session.
  app.quit()
} else {
  void app.whenReady().then(main)
}

/** Only timestamps of state changes are logged, never anything about the input itself. */
function createLog(): (message: string) => void {
  const file = path.join(app.getPath('logs'), 'tracking.log')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  return (message) => {
    const line = `${new Date().toISOString()} ${message}\n`
    if (!app.isPackaged) process.stdout.write(line)
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, `${file}.old`)
      fs.appendFileSync(file, line)
    } catch {
      // Logging must never break tracking.
    }
  }
}

function main(): void {
  app.dock?.hide()
  hardenApp()
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))

  const log = createLog()
  const dataDirectory = app.getPath('userData')
  const settingsStore = new SettingsStore(dataDirectory)
  const store = new FileLedgerStore(dataDirectory)
  const idle: IdleReader = {
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    isScreenLocked: () => powerMonitor.getSystemIdleState(1) === 'locked'
  }
  const controller = new TrackingController({ time: systemTime, idle, power: powerMonitor, scheduler: timerScheduler, store, log })

  let settings: Settings = settingsStore.settings
  let loginItem: LoginItemState = loginItemState()
  let latest: ControllerUpdate | null = null
  nativeTheme.themeSource = settings.appearance

  const windows: WindowManager = new WindowManager(() => tray.bounds)
  const tray: TrayView = new TrayView({
    onClick: () => windows.togglePopover(),
    contextMenu: () =>
      Menu.buildFromTemplate([
        {
          label: latest?.snapshot.status === 'paused' ? 'Resume Tracking' : 'Pause Tracking',
          enabled: latest?.snapshot.status !== 'disabled',
          click: () => controller.togglePause()
        },
        { type: 'separator' },
        { label: 'History…', click: () => windows.open('history') },
        { label: 'Settings…', accelerator: 'Command+,', click: () => windows.open('settings') },
        { type: 'separator' },
        { label: 'Quit Tracking Working Time', accelerator: 'Command+Q', click: () => app.quit() }
      ])
  })

  // The controller publishes its first update while starting, before any window can ask.
  const appState = (): AppState => {
    if (!latest) throw new Error('Tracking has not started')
    return { snapshot: latest.snapshot, stats: latest.stats, settings, loginItem, dataFile: store.file }
  }

  const publish = (): void => {
    if (!latest) return
    tray.render(latest.snapshot, settings)
    const visible = windows.visibleWindows()
    if (visible.length === 0) return
    const state = appState()
    for (const window of visible) window.webContents.send('tracker:state', state)
  }

  controller.on('update', (update: ControllerUpdate) => {
    latest = update
    publish()
  })

  const updateSettings = (changes: Partial<Settings>): void => {
    settings = settingsStore.update(changes)
    nativeTheme.themeSource = settings.appearance
    controller.applySettings(settings)
    publish()
  }

  // MARK: IPC. Every handler checks that the call comes from the app's own page and validates input.

  const handle = (channel: string, handler: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Rejected IPC from an untrusted page')
      return handler(...args)
    })
  }
  const requireBoolean = (value: unknown): boolean => {
    if (typeof value !== 'boolean') throw new TypeError('Expected a boolean')
    return value
  }

  handle('tracker:getState', () => {
    loginItem = loginItemState()
    return appState()
  })
  handle('tracker:getHistory', () => controller.history())
  handle('tracker:pause', () => controller.pause())
  handle('tracker:resume', () => controller.resume())
  handle('tracker:setTrackingEnabled', (enabled) => updateSettings({ automaticTracking: requireBoolean(enabled) }))
  handle('tracker:resetToday', () => controller.resetToday())
  handle('tracker:resetAllData', () => controller.resetAllData())
  handle('tracker:updateSettings', (changes) => {
    if (typeof changes !== 'object' || changes === null) throw new TypeError('Expected settings')
    const known = Object.fromEntries(Object.entries(changes).filter(([key]) => key in DEFAULT_SETTINGS))
    updateSettings(known as Partial<Settings>)
  })
  handle('tracker:setLaunchAtLogin', (enabled) => {
    setLaunchAtLogin(requireBoolean(enabled))
    loginItem = loginItemState()
    publish()
  })
  handle('tracker:openLoginItemsSettings', () => openLoginItemsSettings())
  handle('tracker:exportCsv', async (): Promise<ExportResult> => {
    const parent = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Export Daily Totals',
      defaultPath: path.join(app.getPath('documents'), `tracking-working-time-${dayKey(Date.now())}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false }
    try {
      fs.writeFileSync(result.filePath, toCsv(controller.ledger.rows()), 'utf8')
      return { saved: true, path: result.filePath }
    } catch (error) {
      return { saved: false, error: (error as Error).message }
    }
  })
  handle('tracker:revealDataFile', () => shell.showItemInFolder(store.file))
  handle('tracker:open', (view) => {
    if (view !== 'settings' && view !== 'history') throw new TypeError('Unknown view')
    windows.open(view)
  })
  handle('tracker:closePopover', () => windows.hidePopover())
  handle('tracker:quit', () => app.quit())
  ipcMain.on('tracker:contentHeight', (event, height: unknown) => {
    if (isTrustedSender(event) && typeof height === 'number' && Number.isFinite(height)) windows.setPopoverHeight(height)
  })

  // MARK: Lifecycle

  app.on('second-instance', () => windows.showPopover())
  app.on('window-all-closed', () => {
    // A menu bar app keeps running with no windows open.
  })
  app.on('before-quit', () => {
    controller.shutdown()
    tray.destroy()
  })
  // `kill` and logout send SIGTERM; quit normally so the session is closed and saved.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => app.quit())

  controller.start(settings)
  if (store.recoveredBackup) log(`Unreadable history moved to ${store.recoveredBackup}`)

  if (screenshotDirectory) {
    void captureScreens(path.resolve(screenshotDirectory)).then((files) => {
      log(`Screenshots: ${files.join(', ')}`)
      app.quit()
    })
    return
  }

  // A menu bar app has no window, so the very first launch shows where it lives.
  if (!settingsStore.welcomeShown) {
    settingsStore.markWelcomeShown()
    setTimeout(() => windows.showPopover(), 800)
  }
}
