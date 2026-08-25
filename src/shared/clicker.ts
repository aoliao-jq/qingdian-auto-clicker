export type ClickButton = 'left' | 'middle' | 'right'
export type ClickType = 'single' | 'double'
export type RepeatMode = 'untilStopped' | 'count'
export type PositionMode = 'current' | 'fixed'
export type ClickerPhase = 'idle' | 'countdown' | 'running' | 'error'
export const supportedHotkeys = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
] as const
export type ClickerHotkey = (typeof supportedHotkeys)[number]

export interface ScreenPoint {
  x: number
  y: number
}

export interface ClickerSettings {
  button: ClickButton
  clickType: ClickType
  intervalMs: number
  repeatMode: RepeatMode
  repeatCount: number
  positionMode: PositionMode
  position: ScreenPoint
  startDelaySec: number
  hideWindowOnStart: boolean
  startHotkey: ClickerHotkey
  stopHotkey: ClickerHotkey
}

export interface ClickerState {
  phase: ClickerPhase
  clicks: number
  completedCycles: number
  remainingCycles: number | null
  countdown: number
  message: string
  hotkeysReady: boolean
}

export interface ClickerApi {
  start: (settings: ClickerSettings) => Promise<ClickerState>
  stop: () => Promise<ClickerState>
  getState: () => Promise<ClickerState>
  updateSettings: (settings: ClickerSettings) => Promise<ClickerSettings>
  getCursorPosition: () => Promise<ScreenPoint>
  onState: (callback: (state: ClickerState) => void) => () => void
}

export const defaultClickerSettings: ClickerSettings = {
  button: 'left',
  clickType: 'single',
  intervalMs: 100,
  repeatMode: 'untilStopped',
  repeatCount: 100,
  positionMode: 'current',
  position: { x: 0, y: 0 },
  startDelaySec: 3,
  hideWindowOnStart: false,
  startHotkey: 'F6',
  stopHotkey: 'F7'
}
