import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, session, type IpcMainEvent, type IpcMainInvokeEvent, type WebPreferences } from 'electron'

/** Set by electron-vite while developing; absent in the packaged app. */
export const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

export const rendererIndex = path.join(__dirname, '../renderer/index.html')
const rendererRoot = pathToFileURL(path.dirname(rendererIndex)).href

/** Renderer settings for every window: no Node.js, isolated preload, Chromium sandbox. */
export function secureWebPreferences(): WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    devTools: !app.isPackaged
  }
}

export function isAppUrl(url: string): boolean {
  if (devServerUrl) return url.startsWith(new URL(devServerUrl).origin)
  return url.startsWith(rendererRoot)
}

/** IPC is answered only for the app's own pages. */
export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  return typeof url === 'string' && isAppUrl(url)
}

/**
 * Locks the app down: no network access, no permission prompts, no new windows, no navigation
 * away from the bundled pages. The app has nothing to send anywhere.
 */
export function hardenApp(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    callback({ cancel: !(devServerUrl && isAppUrl(details.url)) })
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
