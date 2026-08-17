<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Aim,
  Clock,
  LocationInformation,
  Mouse,
  Refresh,
  Setting,
  VideoPause,
  VideoPlay
} from '@element-plus/icons-vue'
import {
  defaultClickerSettings,
  type ClickerSettings,
  type ClickerState
} from '../../shared/clicker'

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
const state = ref<ClickerState>({
  phase: 'idle', clicks: 0, completedCycles: 0, remainingCycles: null,
  countdown: 0, message: '正在连接…', hotkeysReady: false
})
const captureCountdown = ref(0)
let removeStateListener: (() => void) | undefined
let disposed = false

const testArmed = ref(false)
const testClicks = ref(0)
const testStartedAt = ref(0)
const testLastClickAt = ref(0)
const testEndedAt = ref(0)
const liveCps = ref(0)
const peakCps = ref(0)
const timerNow = ref(performance.now())
const recentClickTimes: number[] = []
let testTimer: ReturnType<typeof setInterval> | undefined

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
const testDuration = computed(() => {
  if (!testStartedAt.value) return 0
  const end = testEndedAt.value || testLastClickAt.value || timerNow.value
  return Math.max(0, (end - testStartedAt.value) / 1000)
})
const averageCps = computed(() => {
  if (testClicks.value < 2 || testLastClickAt.value <= testStartedAt.value) return 0
  return (testClicks.value - 1) / ((testLastClickAt.value - testStartedAt.value) / 1000)
})
const receiveRate = computed(() => {
  if (!state.value.clicks) return 0
  return Math.min(100, (testClicks.value / state.value.clicks) * 100)
})

watch(settings, (value) => {
  const snapshot = { ...value, position: { ...value.position } }
  localStorage.setItem(storageKey, JSON.stringify(snapshot))
  void window.api.updateSettings(snapshot)
}, { deep: true })

watch(() => state.value.phase, (phase, previous) => {
  if (testArmed.value && ['running', 'countdown'].includes(previous) && ['idle', 'error'].includes(phase)) {
    finishTest()
  }
})

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

function resetTest(): void {
  testArmed.value = false
  testClicks.value = 0
  testStartedAt.value = 0
  testLastClickAt.value = 0
  testEndedAt.value = 0
  liveCps.value = 0
  peakCps.value = 0
  recentClickTimes.length = 0
}

function prepareTest(): void {
  resetTest()
  testArmed.value = true
  settings.positionMode = 'current'
  if (settings.hideWindowOnStart) {
    settings.hideWindowOnStart = false
    ElMessage.info('测速时已自动关闭“启动后隐藏窗口”')
  } else {
    ElMessage.success('测速已准备：按 F6 后把鼠标移入测试区域')
  }
}

function finishTest(): void {
  testArmed.value = false
  testEndedAt.value = testLastClickAt.value || performance.now()
  liveCps.value = 0
}

function recordTestClick(): void {
  if (!testArmed.value) return
  const now = performance.now()
  if (!testStartedAt.value) testStartedAt.value = now
  testLastClickAt.value = now
  testClicks.value += 1
  recentClickTimes.push(now)
  while (recentClickTimes.length && recentClickTimes[0] < now - 1000) recentClickTimes.shift()
  liveCps.value = recentClickTimes.length
  peakCps.value = Math.max(peakCps.value, liveCps.value)
}

onMounted(async () => {
  removeStateListener = window.api.onState((nextState) => { state.value = nextState })
  await window.api.updateSettings(settingsSnapshot())
  state.value = await window.api.getState()
  testTimer = setInterval(() => {
    const now = performance.now()
    timerNow.value = now
    while (recentClickTimes.length && recentClickTimes[0] < now - 1000) recentClickTimes.shift()
    liveCps.value = testArmed.value ? recentClickTimes.length : 0
  }, 100)
})

onUnmounted(() => {
  disposed = true
  removeStateListener?.()
  if (testTimer) clearInterval(testTimer)
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
        <span class="hotkey-state" :class="{ muted: !state.hotkeysReady }">
          {{ state.hotkeysReady ? 'F6 / F7 快捷键可用' : '全局快捷键不可用' }}
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
            <div class="behavior-setting">
              <div><strong>启动后隐藏窗口</strong><span>停止、完成或按 F7 后自动恢复窗口</span></div>
              <el-switch v-model="settings.hideWindowOnStart" />
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
          <div class="shortcut-list"><div><kbd>F6</kbd><span>启动 / 停止</span></div><div><kbd>F7</kbd><span>紧急停止</span></div></div>
        </aside>
      </section>

      <section class="card speed-test-card">
        <div class="test-header">
          <div class="card-title"><span class="title-icon amber"><Clock /></span><div><h2>点击测速板</h2><p>测试目标区域实际接收到的点击速度，不受网络影响</p></div></div>
          <div class="test-actions"><el-button @click="resetTest"><el-icon><Refresh /></el-icon>清空</el-button><el-button type="primary" @click="prepareTest">{{ testArmed ? '重新准备' : '准备测速' }}</el-button></div>
        </div>
        <div class="test-layout">
          <div class="test-target" :class="{ armed: testArmed }" @mousedown.prevent="recordTestClick">
            <div class="target-ring"><Mouse /></div>
            <strong>{{ testArmed ? '将鼠标停在这里，按 F6 开始' : '点击“准备测速”开始' }}</strong>
            <span>{{ testArmed ? '正在记录测试区域收到的每一次点击' : '建议使用当前位置、指定次数进行测试' }}</span>
          </div>
          <div class="test-metrics">
            <div><span>实收点击</span><strong>{{ testClicks.toLocaleString() }}</strong><small>次</small></div>
            <div><span>平均速度</span><strong>{{ averageCps.toFixed(1) }}</strong><small>次/秒</small></div>
            <div><span>实时 / 峰值</span><strong>{{ liveCps }} / {{ peakCps }}</strong><small>CPS</small></div>
            <div><span>测试时间</span><strong>{{ testDuration.toFixed(2) }}</strong><small>秒</small></div>
            <div><span>接收成功率</span><strong>{{ receiveRate.toFixed(1) }}%</strong><small>实收 / 发出</small></div>
          </div>
        </div>
      </section>
    </main>

    <footer>轻点 v1.1.0 · 所有操作均在本机完成</footer>
  </div>
</template>
