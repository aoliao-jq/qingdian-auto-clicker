import { app, shell, BrowserWindow, ipcMain, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { Button, mouse, Point } from '@nut-tree-fork/nut-js'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import {
  defaultClickerSettings,
  type ClickButton,
  type ClickerSettings,
  type ClickerState
} from '../shared/clicker'
import type { UpdateState } from '../shared/updater'

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-software-rasterizer')

let mainWindow: BrowserWindow | null = null
let currentSettings: ClickerSettings = structuredClone(defaultClickerSettings)
let state: ClickerState = {
  phase: 'idle',
  clicks: 0,
  completedCycles: 0,
  remainingCycles: null,
  countdown: 0,
  message: '准备就绪',
  hotkeysReady: false
}
let clickTimer: ReturnType<typeof setTimeout> | undefined
let countdownTimer: ReturnType<typeof setInterval> | undefined
let runToken = 0
let lastStateSentAt = 0
let hiddenForCurrentRun = false
let updateState: UpdateState = {
  phase: app.isPackaged ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
  progress: 0,
  message: app.isPackaged ? '可以检查新版本' : '开发模式下不检查更新'
}

mouse.config.autoDelayMs = 0

function normalizeSettings(input: ClickerSettings): ClickerSettings {
  const allowedButtons: ClickButton[] = ['left', 'middle', 'right']
  return {
    button: allowedButtons.includes(input.button) ? input.button : 'left',
    clickType: input.clickType === 'double' ? 'double' : 'single',
    intervalMs: Math.min(60_000, Math.max(1, Math.round(Number(input.intervalMs) || 100))),
    repeatMode: input.repeatMode === 'count' ? 'count' : 'untilStopped',
    repeatCount: Math.min(1_000_000, Math.max(1, Math.round(Number(input.repeatCount) || 1))),
    positionMode: input.positionMode === 'fixed' ? 'fixed' : 'current',
    position: {
      x: Math.round(Number(input.position?.x) || 0),
      y: Math.round(Number(input.position?.y) || 0)
    },
    startDelaySec: Math.min(30, Math.max(0, Math.round(Number(input.startDelaySec) || 0))),
    hideWindowOnStart: Boolean(input.hideWindowOnStart)
  }
}

function buttonFor(value: ClickButton): Button {
  if (value === 'right') return Button.RIGHT
  if (value === 'middle') return Button.MIDDLE
  return Button.LEFT
}

function clearTimers(): void {
  if (clickTimer) clearTimeout(clickTimer)
  if (countdownTimer) clearInterval(countdownTimer)
  clickTimer = undefined
  countdownTimer = undefined
}

function publishState(force = true): ClickerState {
  const now = Date.now()
  if (force || now - lastStateSentAt >= 100) {
    lastStateSentAt = now
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clicker:state', { ...state })
    }
  }
  return { ...state }
}

function publishUpdateState(nextState?: Partial<UpdateState>): UpdateState {
  updateState = { ...updateState, ...nextState }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:state', { ...updateState })
  }
  return { ...updateState }
}

function updateErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/404|not found/i.test(detail)) return '暂未找到可用的发布版本'
  if (/net|network|internet|connect|timeout/i.test(detail)) return '网络连接失败，请稍后重试'
  return '更新检查失败，请稍后重试'
}

function registerUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    publishUpdateState({ phase: 'checking', progress: 0, message: '正在检查新版本…' })
  })
  autoUpdater.on('update-available', (info) => {
    publishUpdateState({
      phase: 'available',
      latestVersion: info.version,
      progress: 0,
      message: `发现新版本 v${info.version}`
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    publishUpdateState({
      phase: 'not-available',
      latestVersion: info.version,
      progress: 0,
      message: '当前已是最新版本'
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.min(100, Math.max(0, Math.round(progress.percent)))
    publishUpdateState({
      phase: 'downloading',
      progress: percent,
      message: `正在下载更新 ${percent}%`
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publishUpdateState({
      phase: 'downloaded',
      latestVersion: info.version,
      progress: 100,
      message: '更新已下载，重启后即可完成安装'
    })
  })
  autoUpdater.on('error', (error) => {
    publishUpdateState({ phase: 'error', progress: 0, message: updateErrorMessage(error) })
  })

  ipcMain.handle('updater:get-state', () => ({ ...updateState }))
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return publishUpdateState()
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      publishUpdateState({ phase: 'error', progress: 0, message: updateErrorMessage(error) })
    }
    return { ...updateState }
  })
  ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged || updateState.phase !== 'available') return { ...updateState }
    publishUpdateState({ phase: 'downloading', progress: 0, message: '正在准备下载更新…' })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      publishUpdateState({ phase: 'error', progress: 0, message: updateErrorMessage(error) })
    }
    return { ...updateState }
  })
  ipcMain.handle('updater:install', () => {
    if (app.isPackaged && updateState.phase === 'downloaded') {
      autoUpdater.quitAndInstall(false, true)
    }
  })
}

function hideWindowForRun(): void {
  if (!currentSettings.hideWindowOnStart || !mainWindow || mainWindow.isDestroyed()) return
  hiddenForCurrentRun = true
  setTimeout(() => {
    if (hiddenForCurrentRun && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  }, 120)
}

function restoreWindowAfterRun(): void {
  if (!hiddenForCurrentRun) return
  hiddenForCurrentRun = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function stopClicker(message = '已停止'): ClickerState {
  runToken += 1
  clearTimers()
  state = {
    ...state,
    phase: 'idle',
    countdown: 0,
    message
  }
  restoreWindowAfterRun()
  return publishState()
}

async function runClickCycle(token: number): Promise<void> {
  if (token !== runToken || state.phase !== 'running') return

  try {
    const cycleStartedAt = Date.now()
    if (currentSettings.positionMode === 'fixed') {
      await mouse.setPosition(new Point(currentSettings.position.x, currentSettings.position.y))
    }

    const button = buttonFor(currentSettings.button)
    if (currentSettings.clickType === 'double') {
      await mouse.doubleClick(button)
    } else {
      await mouse.click(button)
    }

    if (token !== runToken || state.phase !== 'running') return

    const nextCycles = state.completedCycles + 1
    const nextClicks = state.clicks + (currentSettings.clickType === 'double' ? 2 : 1)
    const remaining =
      currentSettings.repeatMode === 'count'
        ? Math.max(0, currentSettings.repeatCount - nextCycles)
        : null

    state = {
      ...state,
      clicks: nextClicks,
      completedCycles: nextCycles,
      remainingCycles: remaining,
      message: `运行中 · 已执行 ${nextCycles} 次`
    }
    publishState(false)

    if (remaining === 0) {
      stopClicker('任务已完成')
      return
    }

    const cycleElapsedMs = Date.now() - cycleStartedAt
    const nextDelayMs = Math.max(0, currentSettings.intervalMs - cycleElapsedMs)
    clickTimer = setTimeout(() => void runClickCycle(token), nextDelayMs)
  } catch (error) {
    clearTimers()
    state = {
      ...state,
      phase: 'error',
      countdown: 0,
      message: error instanceof Error ? error.message : '鼠标点击执行失败'
    }
    restoreWindowAfterRun()
    publishState()
  }
}

function beginRun(token: number): void {
  if (token !== runToken) return
  state = {
    ...state,
    phase: 'running',
    countdown: 0,
    message: '运行中'
  }
  publishState()
  void runClickCycle(token)
}

function startClicker(input: ClickerSettings): ClickerState {
  clearTimers()
  runToken += 1
  const token = runToken
  currentSettings = normalizeSettings(input)

  state = {
    ...state,
    phase: currentSettings.startDelaySec > 0 ? 'countdown' : 'running',
    clicks: 0,
    completedCycles: 0,
    remainingCycles:
      currentSettings.repeatMode === 'count' ? currentSettings.repeatCount : null,
    countdown: currentSettings.startDelaySec,
    message:
      currentSettings.startDelaySec > 0
        ? `${currentSettings.startDelaySec} 秒后开始`
        : '运行中'
  }
  publishState()
  hideWindowForRun()

  if (currentSettings.startDelaySec === 0) {
    void runClickCycle(token)
    return { ...state }
  }

  const deadline = Date.now() + currentSettings.startDelaySec * 1000
  countdownTimer = setInterval(() => {
    if (token !== runToken) return
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    state = {
      ...state,
      countdown: seconds,
      message: seconds > 0 ? `${seconds} 秒后开始` : '正在启动'
    }
    publishState()
    if (seconds === 0) {
      if (countdownTimer) clearInterval(countdownTimer)
      countdownTimer = undefined
      beginRun(token)
    }
  }, 100)

  return { ...state }
}

function registerClickerIpc(): void {
  ipcMain.handle('clicker:start', (_event, settings: ClickerSettings) => startClicker(settings))
  ipcMain.handle('clicker:stop', () => stopClicker())
  ipcMain.handle('clicker:get-state', () => ({ ...state }))
  ipcMain.handle('clicker:update-settings', (_event, settings: ClickerSettings) => {
    currentSettings = normalizeSettings(settings)
    return currentSettings
  })
  ipcMain.handle('clicker:get-cursor-position', async () => {
    const point = await mouse.getPosition()
    return { x: point.x, y: point.y }
  })
}

function registerHotkeys(): void {
  const toggleReady = globalShortcut.register('F6', () => {
    if (state.phase === 'running' || state.phase === 'countdown') {
      stopClicker('已通过 F6 停止')
    } else {
      startClicker(currentSettings)
    }
  })
  const stopReady = globalShortcut.register('F7', () => stopClicker('已紧急停止'))
  state = {
    ...state,
    hotkeysReady: toggleReady && stopReady,
    message: toggleReady && stopReady ? '准备就绪' : '全局快捷键注册失败，可使用界面按钮'
  }
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1000,
    minHeight: 720,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fa',
    title: '轻点 - 鼠标连点器',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    publishState()
    publishUpdateState()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.shubiaoliandianqi.autoclicker')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerClickerIpc()
  registerUpdater()
  registerHotkeys()
  createWindow()

  if (app.isPackaged) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch((error) => {
        publishUpdateState({ phase: 'error', progress: 0, message: updateErrorMessage(error) })
      })
    }, 5000)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  clearTimers()
  globalShortcut.unregisterAll()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
