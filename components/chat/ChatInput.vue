<script setup lang="ts">
export interface UploadedImage {
  id: string
  dataUrl: string
  filename: string
}

const props = defineProps<{
  input: string
  isLoading: boolean
  enableThinking: boolean
  images: UploadedImage[]
  supportsVision: boolean
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  stop: []
  'update:enableThinking': [value: boolean]
  'update:images': [images: UploadedImage[]]
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

function handleKeydown(e: KeyboardEvent) {
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
</script>

<template>
  <footer class="shrink-0 bg-white px-3 sm:px-4 pb-3 sm:pb-4 pt-1 sm:pt-2">
    <form class="max-w-full sm:max-w-3xl mx-auto" @submit.prevent="emit('submit')">
      <div
        class="flex items-end gap-2 bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md focus-within:shadow-md focus-within:border-blue-300/50 transition-all duration-200 px-3 sm:px-4 py-2.5 sm:py-3"
      >
        <label
          class="shrink-0 flex items-center justify-center rounded-lg active:scale-95 transition-all"
          :class="[
            supportsVision
              ? 'text-gray-400 hover:text-gray-600 cursor-pointer'
              : 'text-gray-300 cursor-not-allowed',
            images.length > 0 && supportsVision ? 'text-blue-500' : ''
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
            <div
              v-for="img in images"
              :key="img.id"
              class="relative shrink-0 group/img"
            >
              <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-gray-200">
                <img :src="img.dataUrl" :alt="img.filename" class="w-full h-full object-cover" />
              </div>
              <button
                class="absolute -top-2 -right-2 w-5 h-5 bg-gray-500 text-white rounded-full flex items-center justify-center hover:bg-gray-700 active:scale-90 transition-all opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 shadow-sm"
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
            class="w-full resize-none text-sm sm:text-base text-gray-800 placeholder-gray-400 bg-transparent focus:outline-none min-h-[24px] max-h-[120px] sm:max-h-[160px] leading-relaxed"
            placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
            rows="1"
            :disabled="isLoading"
            @input="inputValue = ($event.target as HTMLTextAreaElement).value"
            @keydown="handleKeydown"
          />
        </div>

        <button
          v-if="!isLoading"
          type="submit"
          data-testid="send-btn"
          :disabled="!input.trim() || isOverLimit"
          class="shrink-0 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl transition-all duration-200"
          :class="
            input.trim() && !isOverLimit
              ? 'bg-blue-600 hover:bg-blue-700 text-white active:scale-95 shadow-sm hover:shadow'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
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
          class="shrink-0 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white active:scale-95 transition-all shadow-sm"
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
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 min-h-[32px]"
          :class="
            enableThinking
              ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
          "
          v-tooltip="enableThinking ? '深度思考已开启（更准但较慢）' : '快速模式（关闭深度思考）'"
          @click="emit('update:enableThinking', !enableThinking)"
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
          思考
        </button>

        <span
          v-if="inputLength > 0"
          class="text-[11px] transition-colors duration-200 ml-auto"
          :class="
            isOverLimit
              ? 'text-red-500 font-medium'
              : isNearLimit
                ? 'text-amber-500'
                : 'text-gray-300'
          "
        >
          {{ inputLength }} / {{ MAX_INPUT_LENGTH }}
        </span>
      </div>
    </form>
  </footer>
</template>
