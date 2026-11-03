import { app, shell } from 'electron'
import type { LoginItemState } from '../shared/types'

/**
 * Launch at Login through macOS's own login item service (SMAppService on macOS 13+). Only the
 * packaged app can register itself; in development it would register Electron instead.
 */
export function loginItemState(): LoginItemState {
  if (!app.isPackaged) return { supported: false, enabled: false, requiresApproval: false }
  const settings = app.getLoginItemSettings({ type: 'mainAppService' }) as Electron.LoginItemSettings & { status?: string }
  const status = settings.status
  return {
    supported: true,
    enabled: status ? status === 'enabled' || status === 'requires-approval' : settings.openAtLogin,
    requiresApproval: status === 'requires-approval'
  }
}

export function setLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, type: 'mainAppService' })
}

export function openLoginItemsSettings(): Promise<void> {
  return shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension')
}
