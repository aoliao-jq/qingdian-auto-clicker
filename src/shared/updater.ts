export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string
  progress: number
  message: string
}

export interface UpdaterApi {
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  install: () => Promise<void>
  getState: () => Promise<UpdateState>
  onState: (callback: (state: UpdateState) => void) => () => void
}
