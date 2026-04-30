<script setup lang="ts">
import type { ModelOption } from '~/composables/useChatConfig'

const props = defineProps<{
  input: string
  isLoading: boolean
  enableThinking: boolean
  currentModel: string
  modelOptions: ModelOption[]
}>()

const emit = defineEmits<{
  'update:input': [value: string]
  submit: []
  stop: []
  'update:enableThinking': [value: boolean]
  'update:currentModel': [value: string]
}>()

const inputValue = computed({
  get: () => props.input,
  set: (val: string) => emit('update:input', val)
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const MAX_INPUT_LENGTH = 1000

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
</script>

<template>
  <footer class="shrink-0 border-t border-gray-200 bg-white px-3 sm:px-4 py-3 sm:py-4">
    <form class="max-w-full sm:max-w-4xl mx-auto" @submit.prevent="emit('submit')">
      <div class="flex items-end gap-2">
        <textarea
          ref="textareaRef"
          :value="inputValue"
          data-testid="chat-input"
          class="flex-1 resize-none rounded-xl border border-gray-300 px-3 sm:px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[44px] max-h-[120px] sm:max-h-[160px]"
          placeholder="输入你的问题..."
          rows="1"
          :disabled="isLoading"
          @input="inputValue = ($event.target as HTMLTextAreaElement).value"
          @keydown="handleKeydown"
        />
        <button
          v-if="!isLoading"
          type="submit"
          data-testid="send-btn"
          :disabled="!input.trim() || isOverLimit"
          class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:scale-95 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 sm:w-5 sm:h-5">
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
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 sm:w-5 sm:h-5">
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

        <select
          :value="currentModel"
          class="px-2 sm:px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer min-h-[36px]"
          @change="emit('update:currentModel', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>

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
