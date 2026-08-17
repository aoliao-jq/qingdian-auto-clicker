import { ElectronAPI } from '@electron-toolkit/preload'
import type { ClickerApi } from '../shared/clicker'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ClickerApi
  }
}
