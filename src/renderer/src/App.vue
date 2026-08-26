<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Aim,
  Clock,
  Download,
  LocationInformation,
  Mouse,
  Setting,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue'
import {
  defaultClickerSettings,
  supportedHotkeys,
  type ClickerSettings,
  type ClickerState
} from '../../shared/clicker'
import type { UpdateState } from '../../shared/updater'

const storageKey = 'pulse-click-settings'

function loadSettings(): ClickerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<ClickerSettings>
    return {
      ...defaultClickerSettings,
      ...saved,
      position: { ...defaultClickerSettings.position, ...(saved.position || {}) },
      hideWindowOnStart: saved.hideWindowOnStart ?? false
    }
  } catch {
    return structuredClone(defaultClickerSettings)
  }
}

const settings = reactive<ClickerSettings>(loadSettings())
const hotkeyOptions = supportedHotkeys
const state = ref<ClickerState>({
  phase: 'idle', clicks: 0, completedCycles: 0, remainingCycles: null,
  countdown: 0, message: '正在连接…', hotkeysReady: false
})
const captureCountdown = ref(0)
let removeStateListener: (() => void) | undefined
let removeUpdateListener: (() => void) | undefined
let disposed = false
let promptedVersion = ''
let installPromptShown = false
const updateState = ref<UpdateState>({
  phase: 'idle',
  currentVersion: '1.1.2',
  progress: 0,
  message: '可以检查新版本'
})

function settingsSnapshot(): ClickerSettings {
  return { ...settings, position: { ...settings.position } }
}

const isActive = computed(() => ['running', 'countdown'].includes(state.value.phase))
const statusText = computed(() => {
  if (state.value.phase === 'running') return '运行中'
  if (state.value.phase === 'countdown') return `${state.value.countdown} 秒后开始`
  if (state.value.phase === 'error') return '运行异常'
  return '已就绪'
})
const statusType = computed(() => {
  if (state.value.phase === 'running') return 'success'
  if (state.value.phase === 'countdown') return 'warning'
  if (state.value.phase === 'error') return 'danger'
  return 'info'
})
const theoreticalCps = computed(() => {
  const multiplier = settings.clickType === 'double' ? 2 : 1
  return ((1000 / Math.max(1, settings.intervalMs)) * multiplier).toFixed(1)
})
const updateButtonText = computed(() => {
  if (updateState.value.phase === 'checking') return '检查中…'
  if (updateState.value.phase === 'available') return '下载更新'
  if (updateState.value.phase === 'downloading') return `${updateState.value.progress}%`
  if (updateState.value.phase === 'downloaded') return '重启安装'
  if (updateState.value.phase === 'disabled') return '开发模式'
  return '检查更新'
})
const updateButtonType = computed(() =>
  updateState.value.phase === 'downloaded' ? 'success' : 'primary'
)
const updateBusy = computed(() => ['checking', 'downloading'].includes(updateState.value.phase))
const updateDisabled = computed(() => updateBusy.value || updateState.value.phase === 'disabled')

watch(settings, (value) => {
  const snapshot = { ...value, position: { ...value.position } }
  localStorage.setItem(storageKey, JSON.stringify(snapshot))
  void window.api.updateSettings(snapshot)
}, { deep: true })

async function toggleClicker(): Promise<void> {
  try {
    state.value = isActive.value
      ? await window.api.stop()
      : await window.api.start(settingsSnapshot())
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

async function capturePosition(): Promise<void> {
  if (captureCountdown.value) return
  try {
    for (let second = 3; second > 0; second -= 1) {
      captureCountdown.value = second
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (disposed) return
    }
    const point = await window.api.getCursorPosition()
    settings.position = point
    settings.positionMode = 'fixed'
    ElMessage.success(`已记录坐标 ${point.x}, ${point.y}`)
  } finally {
    captureCountdown.value = 0
  }
}

function applyInterval(value: number): void {
  settings.intervalMs = value
}

async function handleIncomingUpdate(nextState: UpdateState): Promise<void> {
  updateState.value = nextState

  if (
    nextState.phase === 'available' &&
    nextState.latestVersion &&
    promptedVersion !== nextState.latestVersion
  ) {
    promptedVersion = nextState.latestVersion
    try {
      await ElMessageBox.confirm(
        `当前版本为 v${nextState.currentVersion}，检测到新版本 v${nextState.latestVersion}。是否立即下载更新？`,
        '发现新版本',
        {
          confirmButtonText: '立即下载',
          cancelButtonText: '稍后再说',
          type: 'success',
          closeOnClickModal: false
        }
      )
      updateState.value = await window.updater.download()
    } catch {
      // 用户选择稍后更新时，顶部仍保留“下载更新”按钮。
    }
  }

  if (nextState.phase === 'downloaded' && !installPromptShown) {
    installPromptShown = true
    try {
      await ElMessageBox.confirm(
        `新版本 v${nextState.latestVersion} 已下载完成，是否立即重启并安装？`,
        '更新已准备好',
        {
          confirmButtonText: '立即重启安装',
          cancelButtonText: '稍后安装',
          type: 'success',
          closeOnClickModal: false
        }
      )
      await window.updater.install()
    } catch {
      // 用户稍后可以通过顶部的“重启安装”按钮继续。
    }
  }
}

async function handleUpdateAction(): Promise<void> {
  try {
    if (updateState.value.phase === 'downloaded') {
      await window.updater.install()
      return
    }
    if (updateState.value.phase === 'available') {
      updateState.value = await window.updater.download()
      return
    }
    updateState.value = await window.updater.check()
    if (updateState.value.phase === 'not-available') ElMessage.success('当前已是最新版本')
    if (updateState.value.phase === 'available') {
      ElMessage.success(`发现新版本 v${updateState.value.latestVersion}`)
    }
    if (updateState.value.phase === 'error') ElMessage.error(updateState.value.message)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '更新操作失败')
  }
}

onMounted(async () => {
  removeStateListener = window.api.onState((nextState) => { state.value = nextState })
  removeUpdateListener = window.updater.onState((nextState) => {
    void handleIncomingUpdate(nextState)
  })
  await window.api.updateSettings(settingsSnapshot())
  state.value = await window.api.getState()
  updateState.value = await window.updater.getState()
  if (updateState.value.phase !== 'disabled') {
    void window.updater.check().then((nextState) => handleIncomingUpdate(nextState))
  }
})

onUnmounted(() => {
  disposed = true
  removeStateListener?.()
  removeUpdateListener?.()
})
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="brand-icon"><Mouse /></div>
        <div><h1>轻点</h1><p>简单好用的鼠标连点器</p></div>
      </div>
      <div class="top-status">
        <div class="update-control">
          <div class="update-copy">
            <span>v{{ updateState.currentVersion }}</span>
            <small>{{ updateState.message }}</small>
          </div>
          <el-button
            size="small"
            :type="updateButtonType"
            plain
            :loading="updateBusy"
            :disabled="updateDisabled"
            @click="handleUpdateAction"
          >
            <el-icon v-if="!updateBusy"><Download /></el-icon>{{ updateButtonText }}
          </el-button>
        </div>
        <span class="hotkey-state" :class="{ muted: !state.hotkeysReady }">
          {{ state.hotkeysReady ? `${settings.startHotkey} 开始 / ${settings.stopHotkey} 停止` : '全局快捷键不可用' }}
        </span>
        <el-tag :type="statusType" effect="light" round>{{ statusText }}</el-tag>
      </div>
    </header>

    <main class="content">
      <section class="main-grid">
        <div class="settings-column">
          <article class="card">
            <div class="card-title"><span class="title-icon"><Setting /></span><div><h2>点击设置</h2><p>选择点击方式和速度</p></div></div>
            <div class="form-row three">
              <div class="field"><label>鼠标按键</label><el-radio-group v-model="settings.button"><el-radio-button value="left">左键</el-radio-button><el-radio-button value="middle">中键</el-radio-button><el-radio-button value="right">右键</el-radio-button></el-radio-group></div>
              <div class="field"><label>点击类型</label><el-radio-group v-model="settings.clickType"><el-radio-button value="single">单击</el-radio-button><el-radio-button value="double">双击</el-radio-button></el-radio-group></div>
              <div class="field"><label>点击间隔（毫秒）</label><el-input-number v-model="settings.intervalMs" :min="1" :max="60000" :step="1" controls-position="right" /></div>
            </div>
            <div class="presets"><span>快捷速度</span><button v-for="value in [1, 2, 5, 10, 50, 100]" :key="value" :class="{ active: settings.intervalMs === value }" @click="applyInterval(value)">{{ value }}ms</button><span class="estimate">约 {{ theoreticalCps }} 次/秒</span></div>
          </article>

          <article class="card">
            <div class="card-title"><span class="title-icon green"><Aim /></span><div><h2>位置与规则</h2><p>设置点击位置、执行次数和启动行为</p></div></div>
            <div class="form-row two wide-gap">
              <div class="subsection">
                <label class="section-label">点击位置</label>
                <el-radio-group v-model="settings.positionMode"><el-radio value="current">鼠标当前位置</el-radio><el-radio value="fixed">固定坐标</el-radio></el-radio-group>
                <div class="coordinates">
                  <el-input-number v-model="settings.position.x" :controls="false" :disabled="settings.positionMode !== 'fixed'" placeholder="X" />
                  <el-input-number v-model="settings.position.y" :controls="false" :disabled="settings.positionMode !== 'fixed'" placeholder="Y" />
                  <el-button :loading="captureCountdown > 0" @click="capturePosition"><el-icon><LocationInformation /></el-icon>{{ captureCountdown ? `${captureCountdown}秒` : '采集坐标' }}</el-button>
                </div>
              </div>
              <div class="subsection">
                <label class="section-label">执行方式</label>
                <el-radio-group v-model="settings.repeatMode"><el-radio value="untilStopped">持续运行</el-radio><el-radio value="count">指定次数</el-radio></el-radio-group>
                <div class="rule-row">
                  <el-input-number v-model="settings.repeatCount" :min="1" :max="1000000" :disabled="settings.repeatMode !== 'count'" controls-position="right" />
                  <span>启动延迟</span><el-input-number v-model="settings.startDelaySec" :min="0" :max="30" controls-position="right" /><span>秒</span>
                </div>
              </div>
            </div>
            <div class="behavior-grid">
              <div class="behavior-setting hotkey-setting">
                <div class="behavior-copy"><strong>全局快捷键</strong><span>可在 F1 至 F12 中分别选择开始键和停止键</span></div>
                <div class="hotkey-pickers">
                  <label><span>开始</span><el-select v-model="settings.startHotkey" size="small"><el-option v-for="key in hotkeyOptions" :key="`start-${key}`" :label="key" :value="key" :disabled="key === settings.stopHotkey" /></el-select></label>
                  <label><span>停止</span><el-select v-model="settings.stopHotkey" size="small"><el-option v-for="key in hotkeyOptions" :key="`stop-${key}`" :label="key" :value="key" :disabled="key === settings.startHotkey" /></el-select></label>
                </div>
              </div>
              <div class="behavior-setting">
                <div class="behavior-copy"><strong>启动后隐藏窗口</strong><span>停止、完成或按 {{ settings.stopHotkey }} 后自动恢复窗口</span></div>
                <el-switch v-model="settings.hideWindowOnStart" />
              </div>
            </div>
          </article>
        </div>

        <aside class="card control-card">
          <div class="control-header"><span>控制中心</span><el-icon><Clock /></el-icon></div>
          <div class="count-value"><strong>{{ state.clicks.toLocaleString() }}</strong><span>本次点击</span></div>
          <button class="start-button" :class="{ running: isActive }" @click="toggleClicker">
            <el-icon :size="30"><VideoPause v-if="isActive" /><VideoPlay v-else /></el-icon>
          </button>
          <h3>{{ state.message }}</h3>
          <p>{{ settings.repeatMode === 'count' ? `剩余 ${state.remainingCycles ?? settings.repeatCount} 次` : '持续运行模式' }}</p>
          <el-button class="main-action" :type="isActive ? 'danger' : 'primary'" size="large" @click="toggleClicker"><el-icon><VideoPause v-if="isActive" /><VideoPlay v-else /></el-icon>{{ isActive ? '停止连点' : '启动连点' }}</el-button>
          <div class="shortcut-list"><div><kbd>{{ settings.startHotkey }}</kbd><span>开始连点</span></div><div><kbd>{{ settings.stopHotkey }}</kbd><span>停止连点</span></div></div>
        </aside>
      </section>

    </main>

    <footer>轻点 v{{ updateState.currentVersion }} · 所有操作均在本机完成</footer>
  </div>
</template>
