<script setup lang="ts">
import type { ModelCapabilities, ModelConfig } from '~/composables/useChatConfig'
import { IMAGE_SIZES, type ImageSize } from '~/utils/image-sizes'

export interface UploadedImage {
  id: string
  dataUrl: string
  filename: string
}

/** 生图成功结果（emit 给父组件用于持久化 + 同步 chat.messages） */
export interface ImageGeneratedResult {
  imageUrl: string
  markdown: string
  seed: number
  inferenceTime: number
  warning?: string
}

const props = defineProps<{
  input: string
  isLoading: boolean
  enableThinking: boolean
  enableWebSearch: boolean
  enableOcr: boolean
  enableImageGeneration: boolean
  images: UploadedImage[]
  supportsVision: boolean
  supportsOcr: boolean
  currentCapabilities: ModelCapabilities
  modelOptions: ModelConfig[]
  currentModel: string
  /** 当前会话 ID — 用于会话切换时取消进行中的生图请求 */
  currentSessionId: string
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  stop: []
  'update:enableThinking': [value: boolean]
  'update:enableWebSearch': [value: boolean]
  'update:enableOcr': [value: boolean]
  'update:enableImageGeneration': [value: boolean]
  'update:images': [images: UploadedImage[]]
  speechError: [message: string]
  selectModel: [value: string]
  /** 生图成功 — 父组件负责持久化 DB + 同步 chat.messages */
  'image-generated': [result: ImageGeneratedResult]
}>()

const inputValue = computed({
  get: () => props.input,
  set: (val: string) => emit('update:input', val)
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const MAX_INPUT_LENGTH = 1000
const MAX_IMAGES = 5
const MAX_FILE_SIZE = 5 * 1024 * 1024

// useToast 必须在 setup 顶层调用（inject 不能在事件处理函数中调用，否则返回 undefined）
const toast = useToast()

const inputLength = computed(() => props.input.length)
const isOverLimit = computed(() => inputLength.value > MAX_INPUT_LENGTH)
const isNearLimit = computed(() => inputLength.value > MAX_INPUT_LENGTH * 0.8 && !isOverLimit.value)

// 强制思考模型（deepThinking && !toggleableThinking）：按钮应禁用，模型永远思考无法关闭
const isForcedThinking = computed(
  () => props.currentCapabilities.deepThinking && !props.currentCapabilities.toggleableThinking
)

// 图片上传按钮联动：视觉模型始终允许上传，非视觉模型仅在 OCR 开启时允许
const canUploadImage = computed(() => props.supportsVision || props.enableOcr)

// Agent 自动生图 toggle chip 可见性：仅 toolCalling=true 的模型显示
const currentSupportsToolCalling = computed(() => props.currentCapabilities.toolCalling)

const isComposing = ref(false)

function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd() {
  isComposing.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (isComposing.value) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (!isOverLimit.value) {
      emit('submit')
    }
  }
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

watch(
  () => props.input,
  () => nextTick(autoResize)
)

function handleImageUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files) return

  const remaining = MAX_IMAGES - props.images.length
  if (remaining <= 0) return

  const filesToProcess = Array.from(files).slice(0, remaining)

  filesToProcess.forEach((file) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > MAX_FILE_SIZE) return

    const reader = new FileReader()
    reader.onload = () => {
      const newImage: UploadedImage = {
        id: crypto.randomUUID(),
        dataUrl: reader.result as string,
        filename: file.name
      }
      emit('update:images', [...props.images, newImage])
    }
    reader.readAsDataURL(file)
  })

  input.value = ''
}

function removeImage(id: string) {
  emit(
    'update:images',
    props.images.filter((img) => img.id !== id)
  )
}

// ===== 语音识别 =====
const speechSupported = ref(false)
const isRecording = ref(false)
const recognitionRef = ref<any>(null)

onMounted(() => {
  const SpeechRecognitionAPI =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  speechSupported.value = !!SpeechRecognitionAPI
})

onUnmounted(() => {
  recognitionRef.value?.abort()
  recognitionRef.value = null
  // 清理进行中的生图请求（避免组件卸载后请求继续 set 状态）
  abortControllerRef.value?.abort()
  // 清理 Esc 键监听
  if (import.meta.client) {
    document.removeEventListener('keydown', handleEscKey)
  }
})

function toggleSpeechRecognition() {
  if (props.isLoading) return

  if (isRecording.value && recognitionRef.value) {
    // 手动停止录音
    recognitionRef.value.stop()
    return
  }

  const SpeechRecognitionAPI =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognitionAPI) return

  const recognition = new SpeechRecognitionAPI()
  recognition.lang = 'zh-CN'
  recognition.interimResults = true
  recognition.continuous = false

  recognition.onresult = (event: any) => {
    let finalTranscript = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript
      }
    }
    if (finalTranscript) {
      inputValue.value = (inputValue.value + ' ' + finalTranscript).trim()
    }
  }

  recognition.onerror = (event: any) => {
    isRecording.value = false
    recognitionRef.value = null
    if (event.error === 'not-allowed') {
      emit('speechError', '麦克风权限被拒绝，请在浏览器设置中允许麦克风访问')
    } else if (event.error !== 'aborted') {
      emit('speechError', '语音识别出错，请重试')
    }
  }

  recognition.onend = () => {
    isRecording.value = false
    recognitionRef.value = null
  }

  recognitionRef.value = recognition
  isRecording.value = true
  recognition.start()
}

// ===== 文生图 Workflow =====
// 状态均为 SSR 安全初始值（false / '' / 默认尺寸），不依赖浏览器 API
const showImagePanel = ref(false)
const imagePrompt = ref('')
const selectedSize = ref<ImageSize>('1024x1024')
const isGenerating = ref(false)
const imagePromptRef = ref<HTMLTextAreaElement | null>(null)

/** 当前生图请求的 AbortController — 用于会话切换/组件卸载时取消 */
const abortControllerRef = ref<AbortController | null>(null)

/** 生图 prompt 最大长度（与后端 zod schema 一致） */
const MAX_PROMPT_LENGTH = 2000

const promptLength = computed(() => imagePrompt.value.length)
const isPromptOverLimit = computed(() => promptLength.value > MAX_PROMPT_LENGTH)
const canSubmitImage = computed(
  () => !isGenerating.value && imagePrompt.value.trim().length > 0 && !isPromptOverLimit.value
)

/** 打开/关闭生图面板 */
function toggleImagePanel() {
  if (showImagePanel.value) {
    closeImagePanel()
  } else {
    openImagePanel()
  }
}

function openImagePanel() {
  showImagePanel.value = true
  // 注册 Esc 键监听（仅面板打开时活跃）
  if (import.meta.client) {
    document.addEventListener('keydown', handleEscKey)
  }
  // 聚焦 prompt 输入框
  nextTick(() => {
    imagePromptRef.value?.focus()
  })
}

function closeImagePanel() {
  // 进行中不允许关闭（避免半截状态丢失请求结果）
  if (isGenerating.value) return
  showImagePanel.value = false
  if (import.meta.client) {
    document.removeEventListener('keydown', handleEscKey)
  }
}

function handleEscKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showImagePanel.value && !isGenerating.value) {
    closeImagePanel()
  }
}

/** prompt textarea 自动增高 */
function autoResizePrompt() {
  const el = imagePromptRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

watch(imagePrompt, () => nextTick(autoResizePrompt))

/** 调用 /api/generate-image 生成图片 */
async function handleGenerateImage() {
  if (!canSubmitImage.value) return

  // 防重复提交守卫（双重保护：canSubmitImage + isGenerating）
  isGenerating.value = true

  // 创建 AbortController 用于会话切换/组件卸载时取消
  const controller = new AbortController()
  abortControllerRef.value = controller

  try {
    const result = await $fetch<ImageGeneratedResult>('/api/generate-image', {
      method: 'POST',
      body: {
        prompt: imagePrompt.value.trim(),
        imageSize: selectedSize.value,
        sessionId: props.currentSessionId || undefined
      },
      signal: controller.signal
    })

    // 成功：emit 给父组件持久化 + 同步 chat.messages
    emit('image-generated', {
      imageUrl: result.imageUrl,
      markdown: result.markdown,
      seed: result.seed,
      inferenceTime: result.inferenceTime,
      ...(result.warning !== undefined && { warning: result.warning })
    })

    toast.success('图片已生成')

    // warning 提示（ImgBB 转存失败时）
    if (result.warning) {
      toast.warning(result.warning)
    }

    // 重置面板状态
    imagePrompt.value = ''
    // 先重置 isGenerating，否则 closeImagePanel 的守卫会阻止关闭
    // （finally 块会再设一次 false，重复设置无害）
    isGenerating.value = false
    closeImagePanel()
  } catch (err) {
    // AbortError：用户切换会话或组件卸载导致取消，不弹错误 toast
    if (err instanceof Error && err.name === 'AbortError') return
    const message = err instanceof Error ? err.message : '未知错误'
    toast.error(`图片生成失败：${message}`)
  } finally {
    isGenerating.value = false
    abortControllerRef.value = null
  }
}

// 会话切换时取消进行中的生图请求
watch(
  () => props.currentSessionId,
  (newId, oldId) => {
    if (newId !== oldId && abortControllerRef.value) {
      abortControllerRef.value.abort()
      abortControllerRef.value = null
      isGenerating.value = false
      // 关闭面板（无请求进行中时才能关闭，但刚 abort 完已重置 isGenerating）
      if (showImagePanel.value) {
        showImagePanel.value = false
        if (import.meta.client) {
          document.removeEventListener('keydown', handleEscKey)
        }
      }
    }
  }
)
</script>

<template>
  <footer class="shrink-0 bg-semi-bg-0 px-3 sm:px-4 pb-3 sm:pb-4 pt-1 sm:pt-2">
    <form class="max-w-full sm:max-w-3xl mx-auto" @submit.prevent="emit('submit')">
      <!-- 模型选择 chip 组：横向滚动，更紧凑 -->
      <div
        v-if="modelOptions.length > 0"
        class="flex items-center gap-1 overflow-x-auto mb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          v-for="opt in modelOptions"
          :key="opt.value"
          type="button"
          data-testid="model-chip"
          class="shrink-0 inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full transition-all duration-semi-normal min-h-[28px] active:scale-95 whitespace-nowrap"
          :class="
            currentModel === opt.value
              ? 'bg-semi-primary/10 text-semi-primary-active hover:bg-semi-primary/15'
              : 'bg-transparent text-semi-text-3 hover:bg-semi-fill-0 hover:text-semi-text-2'
          "
          @click="emit('selectModel', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- 文生图 prompt 输入面板：max-height + transition 平滑展开 -->
      <div
        class="overflow-hidden transition-all duration-semi-normal ease-out"
        :style="{
          maxHeight: showImagePanel ? '400px' : '0px',
          opacity: showImagePanel ? 1 : 0,
          marginBottom: showImagePanel ? '8px' : '0px'
        }"
      >
        <div
          class="bg-semi-bg-1 rounded-2xl border border-semi-primary/30 shadow-semi-elevated p-3 sm:p-4"
        >
          <!-- 标题栏 -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span
                class="inline-flex w-6 h-6 rounded-lg bg-gradient-to-br from-semi-primary to-pink-500 items-center justify-center"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-3.5 h-3.5"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </span>
              <h3 class="text-sm font-medium text-semi-text-0">文生图 · Kwai-Kolors/Kolors</h3>
            </div>
            <button
              type="button"
              :disabled="isGenerating"
              :aria-label="isGenerating ? '生图进行中，无法关闭' : '关闭生图面板'"
              v-tooltip="isGenerating ? '' : '关闭'"
              class="p-1.5 rounded-lg text-semi-text-3 hover:text-semi-text-0 hover:bg-semi-fill-1 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              @click="closeImagePanel"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-4 h-4"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <!-- prompt textarea -->
          <textarea
            ref="imagePromptRef"
            v-model="imagePrompt"
            data-testid="image-prompt-input"
            class="w-full resize-none text-sm text-semi-text-0 placeholder-semi-text-3 bg-semi-bg-0 border border-semi-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-semi-primary/20 focus:border-semi-primary/40 min-h-[60px] max-h-[120px] leading-relaxed"
            placeholder="描述你想生成的图片，英文效果更佳。例如：A white cat under the moonlight, soft illustration style"
            rows="2"
            :disabled="isGenerating"
            @keydown.escape.prevent="closeImagePanel"
          />

          <!-- prompt 长度提示 -->
          <div class="flex justify-end mt-1">
            <span
              class="text-semi-micro-md transition-colors duration-semi-normal"
              :class="
                isPromptOverLimit
                  ? 'text-semi-danger font-medium'
                  : 'text-semi-border'
              "
            >
              {{ promptLength }} / {{ MAX_PROMPT_LENGTH }}
            </span>
          </div>

          <!-- imageSize 选择 -->
          <div class="mt-3">
            <div class="text-xs text-semi-text-3 mb-1.5">图片尺寸</div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="size in IMAGE_SIZES"
                :key="size"
                type="button"
                :disabled="isGenerating"
                class="px-2.5 py-1 text-xs font-medium rounded-lg transition-all duration-semi-normal min-h-[28px] active:scale-95"
                :class="
                  selectedSize === size
                    ? 'bg-semi-primary-light text-semi-primary-active border border-semi-primary/30'
                    : 'bg-semi-fill-0 text-semi-text-2 hover:bg-semi-fill-1 border border-transparent'
                "
                @click="selectedSize = size"
              >
                {{ size }}
              </button>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-end gap-2 mt-4">
            <button
              type="button"
              :disabled="isGenerating"
              class="px-3 py-1.5 text-xs font-medium text-semi-text-2 hover:text-semi-text-0 hover:bg-semi-fill-1 rounded-lg transition-all active:scale-95 min-h-[32px] disabled:opacity-50 disabled:cursor-not-allowed"
              @click="closeImagePanel"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="generate-image-submit"
              :disabled="!canSubmitImage"
              class="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-semi-primary hover:bg-semi-primary-hover rounded-lg transition-all active:scale-95 min-h-[32px] shadow-semi-card disabled:bg-semi-fill-1 disabled:text-semi-border disabled:cursor-not-allowed disabled:shadow-none"
              @click="handleGenerateImage"
            >
              <svg
                v-if="isGenerating"
                class="animate-spin w-3.5 h-3.5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-3.5 h-3.5"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              {{ isGenerating ? '正在生成图片...' : '生成图片' }}
            </button>
          </div>
        </div>
      </div>

      <div
        class="flex items-end gap-2 bg-semi-bg-0 rounded-2xl border border-semi-border shadow-semi-card hover:shadow-semi-elevated focus-within:shadow-semi-elevated focus-within:border-semi-primary/40 focus-within:ring-2 focus-within:ring-semi-primary/12 transition-all duration-semi-normal px-3 sm:px-4 py-2.5 sm:py-3"
      >
        <label
          class="shrink-0 flex items-center justify-center rounded-lg active:scale-95 transition-all"
          :class="[
            canUploadImage
              ? 'text-semi-text-3 hover:text-semi-text-2 cursor-pointer'
              : 'text-semi-border cursor-not-allowed',
            images.length > 0 && canUploadImage ? 'text-semi-primary' : ''
          ]"
          :aria-label="canUploadImage ? '添加图片' : '当前模型不支持图片，请先开启 OCR 工具'"
          v-tooltip="canUploadImage ? '添加图片' : '当前模型不支持图片，请先开启 OCR 工具'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-5 h-5"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          <input
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            :disabled="!canUploadImage || images.length >= MAX_IMAGES"
            @change="handleImageUpload"
          />
        </label>

        <!-- Workflow 文生图按钮：动作触发型，点击展开输入面板 -->
        <button
          type="button"
          data-testid="image-gen-btn"
          :aria-label="showImagePanel ? '关闭生图面板' : '打开生图面板'"
          v-tooltip="showImagePanel ? '关闭生图面板' : '文生图'"
          class="shrink-0 relative min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl transition-all duration-semi-normal active:scale-95"
          :class="
            showImagePanel
              ? 'text-semi-primary bg-semi-primary-light hover:bg-semi-primary-light'
              : isGenerating
                ? 'text-semi-border cursor-not-allowed'
                : 'text-semi-text-3 hover:text-semi-text-2 hover:bg-semi-fill-1'
          "
          :disabled="isGenerating"
          @click="toggleImagePanel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-5 h-5 sm:w-4 sm:h-4"
          >
            <path d="M9 11h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </svg>
        </button>

        <div class="flex-1 flex flex-col gap-2 min-w-0">
          <div v-if="images.length > 0" class="flex gap-2 flex-wrap">
            <div v-for="img in images" :key="img.id" class="relative shrink-0 group/img">
              <div
                class="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-semi-border"
              >
                <img :src="img.dataUrl" :alt="img.filename" class="w-full h-full object-cover" />
              </div>
              <button
                class="absolute -top-2 -right-2 w-5 h-5 bg-semi-text-3 text-white rounded-full flex items-center justify-center hover:bg-semi-text-1 active:scale-90 transition-all opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 shadow-semi-card"
                aria-label="删除图片"
                @click="removeImage(img.id)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-3 h-3"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <textarea
            ref="textareaRef"
            :value="inputValue"
            data-testid="chat-input"
            class="w-full resize-none text-sm sm:text-base text-semi-text-0 placeholder-semi-text-3 bg-transparent focus:outline-none min-h-[24px] max-h-[120px] sm:max-h-[160px] leading-relaxed"
            placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
            rows="1"
            :disabled="isLoading"
            @input="inputValue = ($event.target as HTMLTextAreaElement).value"
            @keydown="handleKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
          />
        </div>

        <!-- 语音输入按钮 -->
        <button
          v-if="speechSupported"
          type="button"
          :disabled="isLoading"
          :aria-label="isRecording ? '点击停止录音' : '语音输入'"
          v-tooltip="isLoading ? '' : isRecording ? '点击停止录音' : '语音输入'"
          class="shrink-0 relative min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl transition-all duration-semi-normal active:scale-95"
          :class="
            isRecording
              ? 'text-semi-danger bg-semi-danger-light hover:bg-semi-danger-light'
              : isLoading
                ? 'text-semi-border cursor-not-allowed'
                : 'text-semi-text-3 hover:text-semi-text-2 hover:bg-semi-fill-1'
          "
          @click="toggleSpeechRecognition"
        >
          <span
            v-if="isRecording"
            class="absolute inset-1 rounded-full border-2 border-semi-danger animate-ping opacity-30"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-5 h-5 sm:w-4 sm:h-4 relative z-10"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>

        <button
          v-if="!isLoading"
          type="submit"
          data-testid="send-btn"
          :disabled="!input.trim() || isOverLimit"
          :aria-label="input.trim() && !isOverLimit ? '发送消息' : '发送按钮已禁用'"
          class="shrink-0 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl transition-all duration-semi-normal"
          :class="
            input.trim() && !isOverLimit
              ? 'bg-semi-primary hover:bg-semi-primary-hover text-white active:scale-95 shadow-semi-card hover:shadow-semi-elevated'
              : 'bg-semi-fill-1 text-semi-border cursor-not-allowed'
          "
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-4 h-4"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
        <button
          v-else
          type="button"
          data-testid="stop-btn"
          aria-label="停止生成"
          class="shrink-0 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl bg-semi-primary hover:bg-semi-primary-active text-white active:scale-95 transition-all shadow-semi-card"
          @click="emit('stop')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-3.5 h-3.5"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-2.5">
        <button
          type="button"
          :disabled="isForcedThinking"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-semi-normal min-h-[32px]"
          :class="
            isForcedThinking
              ? 'bg-semi-primary-light text-semi-primary-active cursor-not-allowed'
              : enableThinking
                ? 'bg-semi-primary-light text-semi-primary-active hover:bg-semi-primary-light/80 active:scale-95'
                : 'bg-semi-fill-0 text-semi-text-2 hover:text-semi-text-1 hover:bg-semi-fill-1 active:scale-95'
          "
          v-tooltip="
            isForcedThinking
              ? '该模型强制思考，无法关闭'
              : currentCapabilities.deepThinking
                ? enableThinking
                  ? '思考已开启，点击关闭'
                  : '思考已关闭，点击开启'
                : enableThinking
                  ? '深度思考已开启（更准但较慢）'
                  : '快速模式（关闭深度思考）'
          "
          @click="!isForcedThinking && emit('update:enableThinking', !enableThinking)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-3.5 h-3.5 shrink-0"
          >
            <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
            <path d="M12 12V2a10 10 0 0 1 8.66 14.34" />
          </svg>
          {{ isForcedThinking ? '强制思考' : currentCapabilities.deepThinking ? '思考' : '深度思考' }}
        </button>

        <button
          v-if="!currentCapabilities.vision"
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-semi-normal min-h-[32px]"
          :class="
            enableWebSearch
              ? 'bg-semi-primary-light text-semi-primary-active hover:bg-semi-primary-light/80'
              : 'bg-semi-fill-0 text-semi-text-2 hover:text-semi-text-1 hover:bg-semi-fill-1'
          "
          v-tooltip="enableWebSearch ? '联网搜索已开启' : '联网搜索已关闭'"
          @click="emit('update:enableWebSearch', !enableWebSearch)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-3.5 h-3.5 shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path
              d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
            />
          </svg>
          联网
        </button>

        <button
          v-if="supportsOcr"
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-semi-normal min-h-[32px]"
          :class="
            enableOcr
              ? 'bg-semi-primary-light text-semi-primary-active hover:bg-semi-primary-light/80 active:scale-95'
              : 'bg-semi-fill-0 text-semi-text-2 hover:text-semi-text-1 hover:bg-semi-fill-1 active:scale-95'
          "
          v-tooltip="enableOcr ? '智能 OCR 已开启' : '智能 OCR 已关闭'"
          @click="emit('update:enableOcr', !enableOcr)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-3.5 h-3.5 shrink-0"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="m21 21-4.3-4.3" />
            <circle cx="11" cy="14" r="3" />
          </svg>
          OCR
        </button>

        <!-- Agent「自动生图」toggle chip：仅 toolCalling=true 模型显示 -->
        <button
          v-if="currentSupportsToolCalling"
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-semi-normal min-h-[32px]"
          :class="
            enableImageGeneration
              ? 'bg-semi-primary-light text-semi-primary-active hover:bg-semi-primary-light/80 active:scale-95'
              : 'bg-semi-fill-0 text-semi-text-2 hover:text-semi-text-1 hover:bg-semi-fill-1 active:scale-95'
          "
          v-tooltip="
            enableImageGeneration
              ? 'Agent 自动生图已开启 — LLM 可根据对话内容主动调用生图工具'
              : 'Agent 自动生图已关闭 — 仅按钮触发可生图，LLM 不会主动调用'
          "
          @click="emit('update:enableImageGeneration', !enableImageGeneration)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-3.5 h-3.5 shrink-0"
          >
            <path d="M9 11h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </svg>
          生图
        </button>

        <span
          v-if="inputLength > 0"
          class="text-semi-micro-md transition-colors duration-semi-normal ml-auto"
          :class="
            isOverLimit
              ? 'text-semi-danger font-medium'
              : isNearLimit
                ? 'text-semi-warning'
                : 'text-semi-border'
          "
        >
          {{ inputLength }} / {{ MAX_INPUT_LENGTH }}
        </span>
      </div>
    </form>
  </footer>
</template>
