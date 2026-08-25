import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ClickerApi, ClickerSettings, ClickerState } from '../shared/clicker'
import type { UpdaterApi, UpdateState } from '../shared/updater'

// Custom APIs for renderer
const api: ClickerApi = {
  start: (settings: ClickerSettings) => ipcRenderer.invoke('clicker:start', settings),
  stop: () => ipcRenderer.invoke('clicker:stop'),
  getState: () => ipcRenderer.invoke('clicker:get-state'),
  updateSettings: (settings: ClickerSettings) =>
    ipcRenderer.invoke('clicker:update-settings', settings),
  getCursorPosition: () => ipcRenderer.invoke('clicker:get-cursor-position'),
  onState: (callback: (state: ClickerState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nextState: ClickerState): void => {
      callback(nextState)
    }
    ipcRenderer.on('clicker:state', listener)
    return () => ipcRenderer.removeListener('clicker:state', listener)
  }
}

const updater: UpdaterApi = {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  getState: () => ipcRenderer.invoke('updater:get-state'),
  onState: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nextState: UpdateState): void => {
      callback(nextState)
    }
    ipcRenderer.on('updater:state', listener)
    return () => ipcRenderer.removeListener('updater:state', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('updater', updater)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.updater = updater
}
