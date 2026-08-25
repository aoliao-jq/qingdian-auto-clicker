import { ElectronAPI } from '@electron-toolkit/preload'
import type { ClickerApi } from '../shared/clicker'
import type { UpdaterApi } from '../shared/updater'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClickerApi
    updater: UpdaterApi
  }
}
