<script setup lang="ts">
/**
 * 语音消息气泡组件
 *
 * 展示内容（design.md 决策 10 + 任务 5.1-5.3）：
 *   1. 音频播放控件（播放/暂停 + 进度条 + 时长 mm:ss）
 *   2. 情感标签（柔和配色：暖黄=开心 / 柔和蓝=悲伤 / 柔和红=愤怒 / 灰色=中性）
 *   3. 「转文字」折叠面板（默认折叠，max-height + transition 平滑展开，禁止 v-if 硬切）
 *
 * 降级处理（任务 5.2）：
 *   - 音频 URL 404 时（TTL 过期或文件丢失），<audio> 触发 error 事件
 *   - 静默降级：隐藏播放控件 + 自动展开转文字面板 + 保留情感标签
 *   - 不显示错误 toast（TTL 7 天过期是预期行为，非异常）
 *
 * 气泡宽度（任务 5.3）：
 *   - 用户消息语境下使用 max-w-[92%] sm:max-w-[85%]
 *   - 移动端播放控件与情感标签不溢出
 *
 * SSR 安全：
 *   - 所有 ref 初始值不依赖浏览器 API
 *   - <audio> 元素通过 ref 在 onMounted 后访问
 *   - 时间格式化纯函数，SSR 安全
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

/** 情感类型（与 chat.post.ts ALLOWED_EMOTIONS 白名单一致） */
type Emotion = 'happy' | 'sad' | 'angry' | 'neutral'

const props = defineProps<{
  /** 音频文件 URL（/api/audio/<filename>） */
  audioUrl: string
  /** 情感标签（白名单校验后的值，null 表示未识别） */
  emotion: Emotion | null
  /** 音频时长（秒，服务端 ffprobe 实测，不信任前端上报） */
  duration: number
  /** 转写文本（用于「转文字」折叠面板） */
  transcript: string
}>()

// ===== 播放状态（SSR 安全初始值）=====
const audioRef = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const audioDuration = ref(props.duration || 0)
/** 音频是否可用（404/加载失败时为 false，触发降级） */
const audioAvailable = ref(true)
/** 是否已挂载（避免 SSR 期间访问 audioRef） */
const isMounted = ref(false)

/** 「转文字」面板展开状态（默认折叠，音频降级时自动展开） */
const showTranscript = ref(false)

onMounted(() => {
  isMounted.value = true
})

onUnmounted(() => {
  // 组件卸载时暂停播放，避免音频继续在后台播放
  if (audioRef.value && !audioRef.value.paused) {
    audioRef.value.pause()
  }
})

/**
 * 音频加载错误处理（任务 5.2：404 静默降级）
 *
 * 触发场景：
 *   - TTL 7 天过期，文件已被 audio-ttl plugin 清理
 *   - 文件丢失或损坏
 *   - 网络错误
 *
 * 降级行为：
 *   - audioAvailable = false → 隐藏播放控件
 *   - showTranscript = true → 自动展开转文字面板（让用户至少能看到文字）
 *   - 情感标签保留展示（情感是转写时的快照，不依赖音频文件存在）
 *   - 不显示 toast（TTL 过期是预期行为）
 */
function handleAudioError() {
  audioAvailable.value = false
  isPlaying.value = false
  // 自动展开转文字面板：音频不可用时，文字是唯一信息来源
  if (props.transcript) {
    showTranscript.value = true
  }
}

/** 播放/暂停切换 */
function togglePlay() {
  if (!audioRef.value || !audioAvailable.value) return
  if (audioRef.value.paused) {
    audioRef.value.play().catch(() => {
      // play() 失败视为音频不可用，触发降级
      handleAudioError()
    })
  } else {
    audioRef.value.pause()
  }
}

/** audio 元元数据加载完成：更新实际时长（优先于 props.duration） */
function handleLoadedMetadata() {
  if (audioRef.value && !Number.isNaN(audioRef.value.duration)) {
    audioDuration.value = audioRef.value.duration
  }
}

/** audio 播放时间更新：同步 currentTime */
function handleTimeUpdate() {
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime
  }
}

/** audio 播放结束：重置状态 */
function handleEnded() {
  isPlaying.value = false
  currentTime.value = 0
}

/** audio 开始播放 */
function handlePlay() {
  isPlaying.value = true
}

/** audio 暂停 */
function handlePause() {
  isPlaying.value = false
}

/**
 * 进度条点击跳转（移动端兼容）
 *
 * 注意：input[type=range] 的 click 事件在移动端可能不触发，用 @input 实时响应
 */
function handleSeek(e: Event) {
  if (!audioRef.value || !audioAvailable.value) return
  const target = e.target as HTMLInputElement
  const newTime = Number(target.value)
  if (!Number.isNaN(newTime)) {
    audioRef.value.currentTime = newTime
    currentTime.value = newTime
  }
}

/**
 * 格式化秒数为 mm:ss
 *
 * 输入 0 或负数时返回 '00:00'（防御性）
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const mm = Math.floor(total / 60).toString().padStart(2, '0')
  const ss = (total % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

/** 进度百分比（0-100，用于进度条填充宽度） */
const progressPercent = computed(() => {
  if (audioDuration.value <= 0) return 0
  return Math.min((currentTime.value / audioDuration.value) * 100, 100)
})

/**
 * 情感标签配置（design.md 决策 10）
 *
 * 配色原则：柔和（light bg + 深色文字），避免刺眼
 *   - happy（开心）：暖黄/橙色 → amber
 *   - sad（悲伤）：柔和蓝 → sky
 *   - angry（愤怒）：柔和红 → rose
 *   - neutral（中性）：灰色 → gray
 */
const emotionConfig: Record<Emotion, { label: string; classes: string }> = {
  happy: {
    label: '开心',
    classes: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  sad: {
    label: '悲伤',
    classes: 'bg-sky-50 text-sky-700 border-sky-200'
  },
  angry: {
    label: '愤怒',
    classes: 'bg-rose-50 text-rose-700 border-rose-200'
  },
  neutral: {
    label: '中性',
    classes: 'bg-gray-100 text-gray-600 border-gray-200'
  }
}

const emotionDisplay = computed(() => {
  if (!props.emotion) return null
  return emotionConfig[props.emotion]
})

/** 切换「转文字」面板展开/折叠 */
function toggleTranscript() {
  showTranscript.value = !showTranscript.value
}

/**
 * 监听 audioRef 挂载，绑定事件（Vue 模板 @绑定已够，此处仅做防御性检查）
 *
 * 实际事件绑定通过模板 @play/@pause/@ended/@timeupdate/@loadedmetadata/@error 完成
 */
watch(audioRef, (el) => {
  if (el && import.meta.client) {
    // 重置状态（组件复用场景，如虚拟滚动回收）
    isPlaying.value = !el.paused
    currentTime.value = el.currentTime
  }
})
</script>

<template>
  <div class="voice-message-bubble max-w-[92%] sm:max-w-[85%]">
    <!-- 顶部行：情感标签 + 转文字切换按钮 -->
    <div class="flex items-center justify-between gap-2 mb-1.5">
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- 情感标签（emotion === null 时不展示，design.md 决策 10） -->
        <span
          v-if="emotionDisplay"
          :class="[
            'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-full border whitespace-nowrap',
            emotionDisplay.classes
          ]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-2.5 h-2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
          {{ emotionDisplay.label }}
        </span>
        <!-- 语音消息标识（无情感标签时也展示，让用户知道这是语音消息） -->
        <span
          v-else
          class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-full border whitespace-nowrap bg-gray-50 text-gray-500 border-gray-200"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-2.5 h-2.5"
          >
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
          语音
        </span>
      </div>

      <!-- 转文字切换按钮（仅有转写文本时显示） -->
      <button
        v-if="transcript"
        type="button"
        :aria-label="showTranscript ? '收起转文字' : '展开转文字'"
        v-tooltip="showTranscript ? '收起转文字' : '查看转文字'"
        class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-md text-semi-text-3 hover:text-semi-text-1 hover:bg-semi-fill-1 active:scale-95 transition-all min-w-[32px] min-h-[28px]"
        @click="toggleTranscript"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="w-3 h-3 transition-transform duration-semi-normal"
          :class="showTranscript ? 'rotate-180' : ''"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        转文字
      </button>
    </div>

    <!-- 音频播放控件（audioAvailable=false 时隐藏，任务 5.2 降级） -->
    <div
      v-if="audioAvailable && isMounted"
      class="flex items-center gap-2 sm:gap-2.5 bg-semi-bg-1 rounded-xl px-2 py-1.5"
    >
      <!-- 播放/暂停按钮（触摸目标 ≥ 36px，移动端） -->
      <button
        type="button"
        :aria-label="isPlaying ? '暂停' : '播放'"
        class="shrink-0 min-w-[36px] min-h-[36px] sm:min-w-[32px] sm:min-h-[32px] flex items-center justify-center rounded-full bg-semi-primary text-white hover:bg-semi-primary-hover active:scale-95 transition-all"
        @click="togglePlay"
      >
        <!-- 播放图标 -->
        <svg
          v-if="!isPlaying"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-3.5 h-3.5 sm:w-4 sm:h-4 ml-0.5"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <!-- 暂停图标 -->
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-3.5 h-3.5 sm:w-4 sm:h-4"
        >
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      </button>

      <!-- 进度条 + 时间显示 -->
      <div class="flex-1 min-w-0 flex items-center gap-2">
        <!-- 自定义进度条（移动端触摸友好，input[type=range] 跨浏览器兼容） -->
        <div class="flex-1 min-w-0 relative h-1.5 bg-semi-fill-2 rounded-full overflow-hidden">
          <div
            class="absolute inset-y-0 left-0 bg-semi-primary rounded-full transition-[width] duration-100 ease-out"
            :style="{ width: `${progressPercent}%` }"
          />
          <input
            type="range"
            min="0"
            :max="audioDuration || 0"
            step="0.1"
            :value="currentTime"
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="音频进度"
            @input="handleSeek"
          />
        </div>
        <!-- 时间显示 -->
        <span class="shrink-0 text-[11px] font-mono text-semi-text-3 tabular-nums whitespace-nowrap">
          {{ formatTime(currentTime) }} / {{ formatTime(audioDuration) }}
        </span>
      </div>
    </div>

    <!-- 音频不可用降级提示（仅 audioAvailable=false 时显示） -->
    <div
      v-else-if="!audioAvailable"
      class="flex items-center gap-1.5 text-[11px] text-semi-text-3 bg-semi-fill-1 rounded-lg px-2 py-1"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3 h-3 shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
      <span>音频已过期</span>
    </div>

    <!-- 隐藏的 audio 元素（仅 audioAvailable=true 时渲染，绑定事件） -->
    <audio
      v-if="audioAvailable && isMounted"
      ref="audioRef"
      :src="audioUrl"
      preload="metadata"
      @play="handlePlay"
      @pause="handlePause"
      @ended="handleEnded"
      @timeupdate="handleTimeUpdate"
      @loadedmetadata="handleLoadedMetadata"
      @error="handleAudioError"
    />

    <!-- 「转文字」折叠面板（max-height + transition 平滑展开，禁止 v-if 硬切） -->
    <div
      class="overflow-hidden transition-all duration-semi-normal ease-out"
      :style="{
        maxHeight: showTranscript ? '200px' : '0px',
        opacity: showTranscript ? 1 : 0,
        marginTop: showTranscript ? '8px' : '0px'
      }"
    >
      <div
        class="text-[13px] sm:text-sm text-semi-text-1 leading-relaxed bg-semi-fill-0 rounded-lg px-2.5 py-2 whitespace-pre-wrap break-words"
      >
        {{ transcript }}
      </div>
    </div>
  </div>
</template>
