import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppState, TrackerApi } from '../shared/types'

// The page gets these functions and nothing else: no Node.js, no raw ipcRenderer.
const api: TrackerApi = {
  getState: () => ipcRenderer.invoke('tracker:getState'),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: AppState): void => listener(state)
    ipcRenderer.on('tracker:state', handler)
    return () => {
      ipcRenderer.removeListener('tracker:state', handler)
    }
  },
  getHistory: () => ipcRenderer.invoke('tracker:getHistory'),
  pause: () => ipcRenderer.invoke('tracker:pause'),
  resume: () => ipcRenderer.invoke('tracker:resume'),
  setTrackingEnabled: (enabled) => ipcRenderer.invoke('tracker:setTrackingEnabled', enabled),
  resetToday: () => ipcRenderer.invoke('tracker:resetToday'),
  resetAllData: () => ipcRenderer.invoke('tracker:resetAllData'),
  updateSettings: (changes) => ipcRenderer.invoke('tracker:updateSettings', changes),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('tracker:setLaunchAtLogin', enabled),
  openLoginItemsSettings: () => ipcRenderer.invoke('tracker:openLoginItemsSettings'),
  exportCsv: () => ipcRenderer.invoke('tracker:exportCsv'),
  revealDataFile: () => ipcRenderer.invoke('tracker:revealDataFile'),
  open: (view) => ipcRenderer.invoke('tracker:open', view),
  closePopover: () => ipcRenderer.invoke('tracker:closePopover'),
  quit: () => ipcRenderer.invoke('tracker:quit'),
  reportContentHeight: (height) => ipcRenderer.send('tracker:contentHeight', height)
}

contextBridge.exposeInMainWorld('tracker', api)
