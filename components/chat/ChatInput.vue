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
  <footer class="shrink-0 border-t border-gray-200 bg-white px-3 sm:px-4 py-3 sm:py-4">
    <form class="max-w-full sm:max-w-4xl mx-auto" @submit.prevent="emit('submit')">
      <div class="flex items-end gap-2">
        <div class="flex-1 flex flex-col gap-2">
          <textarea
            ref="textareaRef"
            :value="inputValue"
            data-testid="chat-input"
            class="resize-none rounded-xl border border-gray-300 px-3 sm:px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[44px] max-h-[120px] sm:max-h-[160px]"
            placeholder="输入你的问题..."
            rows="1"
            :disabled="isLoading"
            @input="inputValue = ($event.target as HTMLTextAreaElement).value"
            @keydown="handleKeydown"
          />
          <div v-if="images.length > 0" class="flex gap-2 flex-wrap">
            <div
              v-for="img in images"
              :key="img.id"
              class="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-gray-200 group/img"
            >
              <img :src="img.dataUrl" :alt="img.filename" class="w-full h-full object-cover" />
              <button
                class="absolute -top-1 -right-1 w-5 h-5 bg-gray-800/70 text-white rounded-full flex items-center justify-center hover:bg-gray-800 active:scale-90 transition-all opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 sm:focus-within:opacity-100"
                @click="removeImage(img.id)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
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
        </div>
        <label
          class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-sm font-medium rounded-xl active:scale-95 disabled:cursor-not-allowed transition-all"
          :class="[
            supportsVision
              ? 'text-gray-500 bg-gray-100 hover:bg-gray-200 cursor-pointer'
              : 'text-gray-300 bg-gray-50 cursor-not-allowed',
            images.length > 0 && supportsVision
              ? 'text-blue-600 bg-blue-50 border border-blue-200'
              : '',
            images.length > 0 && !supportsVision ? 'opacity-40' : ''
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
            class="w-4 h-4 sm:w-5 sm:h-5"
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
        <button
          v-if="!isLoading"
          type="submit"
          data-testid="send-btn"
          :disabled="!input.trim() || isOverLimit"
          class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:scale-95 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-4 h-4 sm:w-5 sm:h-5"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
        <button
          v-else
          type="button"
          data-testid="stop-btn"
          class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all"
          @click="emit('stop')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-4 h-4 sm:w-5 sm:h-5"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg transition-all min-h-[36px]"
          :class="
            enableThinking
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-300'
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
          class="text-xs transition-colors duration-200 ml-auto"
          :class="
            isOverLimit
              ? 'text-red-500 font-medium'
              : isNearLimit
                ? 'text-amber-500'
                : 'text-gray-400'
          "
        >
          {{ inputLength }} / {{ MAX_INPUT_LENGTH }}
        </span>
      </div>
    </form>
  </footer>
</template>
