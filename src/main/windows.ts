import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron'
import type { View } from '../shared/types'
import { devServerUrl, rendererIndex, secureWebPreferences } from './security'

const POPOVER_WIDTH = 340
const POPOVER_GAP = 6
/** A click on the menu bar item first blurs (and hides) the popover; ignore the click that follows. */
const REOPEN_GUARD_MS = 300

const WINDOW_SIZES: Record<'settings' | 'history', { width: number; height: number; title: string }> = {
  settings: { width: 560, height: 700, title: 'Settings' },
  history: { width: 760, height: 660, title: 'History' }
}

function load(window: BrowserWindow, view: View): void {
  if (devServerUrl) void window.loadURL(`${devServerUrl}#${view}`)
  else void window.loadFile(rendererIndex, { hash: view })
}

/** The dashboard popover under the menu bar item, plus the Settings and History windows. */
export class WindowManager {
  private popover: BrowserWindow | null = null
  private popoverHiddenAt = 0
  private popoverHeight = 560
  private readonly windows: Partial<Record<'settings' | 'history', BrowserWindow>> = {}

  constructor(private readonly anchor: () => Rectangle) {}

  get popoverVisible(): boolean {
    return this.popover?.isVisible() ?? false
  }

  togglePopover(): void {
    if (this.popoverVisible) this.hidePopover()
    else if (Date.now() - this.popoverHiddenAt > REOPEN_GUARD_MS) this.showPopover()
  }

  showPopover(): void {
    const popover = this.popover ?? this.createPopover()
    this.position(popover)
    app.focus({ steal: true })
    popover.show()
    popover.focus()
  }

  hidePopover(): void {
    if (!this.popover?.isVisible()) return
    this.popover.hide()
    this.popoverHiddenAt = Date.now()
    // Hand keyboard focus back to the app the user was in, unless one of our windows is open.
    if (!this.openWindows().some((window) => window.isVisible())) app.hide()
  }

  /** The renderer reports its content height so the popover fits it exactly. */
  setPopoverHeight(height: number): void {
    this.popoverHeight = Math.round(Math.min(800, Math.max(200, height)))
    if (this.popover) this.position(this.popover)
  }

  open(view: 'settings' | 'history'): void {
    this.hidePopover()
    let window = this.windows[view]
    if (!window || window.isDestroyed()) {
      const { width, height, title } = WINDOW_SIZES[view]
      window = new BrowserWindow({
        width,
        height,
        minWidth: 460,
        minHeight: 420,
        title,
        show: false,
        fullscreenable: false,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#f2f2f4',
        webPreferences: secureWebPreferences()
      })
      window.once('ready-to-show', () => window?.show())
      window.on('closed', () => delete this.windows[view])
      load(window, view)
      this.windows[view] = window
    } else {
      window.show()
    }
    app.focus({ steal: true })
    window.focus()
  }

  /** Every window that is currently showing data, so updates go only where they are seen. */
  visibleWindows(): BrowserWindow[] {
    return [this.popover, ...this.openWindows()].filter(
      (window): window is BrowserWindow => !!window && !window.isDestroyed() && window.isVisible()
    )
  }

  private openWindows(): BrowserWindow[] {
    return Object.values(this.windows).filter((window): window is BrowserWindow => !!window && !window.isDestroyed())
  }

  private createPopover(): BrowserWindow {
    const popover = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: this.popoverHeight,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      roundedCorners: true,
      hasShadow: true,
      webPreferences: secureWebPreferences()
    })
    popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    popover.on('blur', () => {
      if (!popover.webContents.isDevToolsOpened()) this.hidePopover()
    })
    load(popover, 'dashboard')
    this.popover = popover
    return popover
  }

  /** Centred under the menu bar item, kept on the same screen. */
  private position(popover: BrowserWindow): void {
    const anchor = this.anchor()
    const display = anchor.width > 0 ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()
    const area = display.workArea
    const height = Math.min(this.popoverHeight, area.height - 2 * POPOVER_GAP)
    let x = anchor.width > 0 ? Math.round(anchor.x + anchor.width / 2 - POPOVER_WIDTH / 2) : area.x + area.width - POPOVER_WIDTH - 12
    x = Math.max(area.x + POPOVER_GAP, Math.min(x, area.x + area.width - POPOVER_WIDTH - POPOVER_GAP))
    const y = anchor.width > 0 ? Math.round(anchor.y + anchor.height + POPOVER_GAP) : area.y + POPOVER_GAP
    popover.setBounds({ x, y: Math.max(area.y, y), width: POPOVER_WIDTH, height })
  }
}
