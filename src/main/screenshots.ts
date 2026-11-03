import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import type { View } from '../shared/types'
import { devServerUrl, rendererIndex, secureWebPreferences } from './security'

const SIZES: Record<View, { width: number; height: number }> = {
  dashboard: { width: 340, height: 446 },
  settings: { width: 560, height: 1180 },
  history: { width: 760, height: 900 }
}

/**
 * Development tool (`npm run screenshots`): renders every screen offscreen in light and dark
 * mode and saves PNGs, so the UI can be reviewed without clicking through it.
 */
export async function captureScreens(directory: string): Promise<string[]> {
  fs.mkdirSync(directory, { recursive: true })
  const written: string[] = []
  for (const theme of ['light', 'dark'] as const) {
    nativeTheme.themeSource = theme
    for (const view of Object.keys(SIZES) as View[]) {
      const { width, height } = SIZES[view]
      const window = new BrowserWindow({
        width,
        height,
        show: false,
        useContentSize: true,
        webPreferences: { ...secureWebPreferences(), offscreen: true }
      })
      if (devServerUrl) await window.loadURL(`${devServerUrl}#${view}`)
      else await window.loadFile(rendererIndex, { hash: view })
      if (view === 'dashboard') {
        // Stand-in for the frosted popover background.
        await window.webContents.insertCSS(`html, body { background: ${theme === 'dark' ? '#2b2b2e' : '#ececee'} !important; }`)
      }
      await new Promise((resolve) => setTimeout(resolve, 700))
      const image = await window.webContents.capturePage()
      const file = path.join(directory, `${view}-${theme}.png`)
      fs.writeFileSync(file, image.toPNG())
      written.push(file)
      window.destroy()
    }
  }
  return written
}
