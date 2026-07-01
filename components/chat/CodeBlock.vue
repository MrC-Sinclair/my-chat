<script setup lang="ts">
import { hljs } from '~/utils/highlight'

const props = defineProps<{
  code: string
  language?: string
}>()

const emit = defineEmits<{
  copy: [code: string]
}>()

const copied = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)
const isVisible = ref(false)
let observer: IntersectionObserver | null = null

const highlightedCode = computed(() => {
  if (!isVisible.value || !props.code) return ''
  if (props.language && hljs.getLanguage(props.language)) {
    return hljs.highlight(props.code, {
      language: props.language
    }).value
  }
  return hljs.highlightAuto(props.code).value
})

onMounted(() => {
  if (!wrapperRef.value) return

  const checkVisible = () => {
    if (!wrapperRef.value) return
    const rect = wrapperRef.value.getBoundingClientRect()
    if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
      isVisible.value = true
      observer?.disconnect()
      observer = null
    }
  }

  checkVisible()

  if (!isVisible.value) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          isVisible.value = true
          observer?.disconnect()
          observer = null
        }
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(wrapperRef.value)
  }
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
    emit('copy', props.code)
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="code-block-wrapper group relative rounded-lg border border-semi-border bg-semi-code-dark-bg my-3"
  >
    <div
      class="flex items-center justify-between px-4 py-2 bg-semi-code-dark-surface rounded-t-lg border-b border-semi-code-dark-border"
    >
      <span class="text-xs text-semi-code-dark-text font-mono">{{ language || 'text' }}</span>
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs text-semi-code-dark-text hover:text-semi-code-dark-text-strong rounded transition-colors"
        v-tooltip="copied ? '已复制' : '复制代码'"
        @click="handleCopy"
      >
        <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <svg
          v-else
          class="w-4 h-4 text-semi-code-dark-success"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <pre v-if="isVisible" class="p-4 overflow-x-auto"><code
      class="text-sm font-mono leading-relaxed"
      :class="`language-${language || 'plaintext'}`"
      v-html="highlightedCode"
    /></pre>
    <div v-else class="p-4">
      <div class="space-y-2">
        <div class="h-3 bg-semi-code-dark-border rounded animate-pulse w-3/4" />
        <div class="h-3 bg-semi-code-dark-border rounded animate-pulse w-1/2" />
        <div class="h-3 bg-semi-code-dark-border rounded animate-pulse w-2/3" />
      </div>
    </div>
  </div>
</template>

<style>
@import 'highlight.js/styles/github-dark.css';
</style>
