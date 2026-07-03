<script setup lang="ts">
import type { ModelCapabilities, ModelConfig } from '~/composables/useChatConfig'

export interface UploadedImage {
  id: string
  dataUrl: string
  filename: string
}

const props = defineProps<{
  input: string
  isLoading: boolean
  enableThinking: boolean
  enableWebSearch: boolean
  images: UploadedImage[]
  supportsVision: boolean
  currentCapabilities: ModelCapabilities
  modelOptions: ModelConfig[]
  currentModel: string
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  stop: []
  'update:enableThinking': [value: boolean]
  'update:enableWebSearch': [value: boolean]
  'update:images': [images: UploadedImage[]]
  speechError: [message: string]
  selectModel: [value: string]
}>()

const inputValue = computed({
  get: () => props.input,
  set: (val: string) => emit('update:input', val)
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const MAX_INPUT_LENGTH = 1000
const MAX_IMAGES = 5
const MAX_FILE_SIZE = 5 * 1024 * 1024

const inputLength = computed(() => props.input.length)
const isOverLimit = computed(() => inputLength.value > MAX_INPUT_LENGTH)
const isNearLimit = computed(() => inputLength.value > MAX_INPUT_LENGTH * 0.8 && !isOverLimit.value)

// 强制思考模型（deepThinking && !toggleableThinking）：按钮应禁用，模型永远思考无法关闭
const isForcedThinking = computed(
  () => props.currentCapabilities.deepThinking && !props.currentCapabilities.toggleableThinking
)

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
              ? 'bg-semi-primary/10 text-semi-primary hover:bg-semi-primary/15'
              : 'bg-transparent text-semi-text-3 hover:bg-semi-fill-0 hover:text-semi-text-2'
          "
          @click="emit('selectModel', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div
        class="flex items-end gap-2 bg-semi-bg-0 rounded-2xl border border-semi-border shadow-semi-card hover:shadow-semi-elevated focus-within:shadow-semi-elevated focus-within:border-semi-primary/40 focus-within:ring-2 focus-within:ring-semi-primary/12 transition-all duration-semi-normal px-3 sm:px-4 py-2.5 sm:py-3"
      >
        <label
          class="shrink-0 flex items-center justify-center rounded-lg active:scale-95 transition-all"
          :class="[
            supportsVision
              ? 'text-semi-text-3 hover:text-semi-text-2 cursor-pointer'
              : 'text-semi-border cursor-not-allowed',
            images.length > 0 && supportsVision ? 'text-semi-primary' : ''
          ]"
          v-tooltip="supportsVision ? '添加图片' : '当前模型不支持图片'"
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
            :disabled="!supportsVision || images.length >= MAX_IMAGES"
            @change="handleImageUpload"
          />
        </label>

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
              ? 'bg-semi-primary-light text-semi-primary cursor-not-allowed'
              : enableThinking
                ? 'bg-semi-primary-light text-semi-primary hover:bg-semi-primary-light/80 active:scale-95'
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
              ? 'bg-semi-primary-light text-semi-primary hover:bg-semi-primary-light/80'
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
