<script setup lang="ts">
import hljs from 'highlight.js'

const props = defineProps<{
  code: string
  language?: string
}>()

const emit = defineEmits<{
  copy: [code: string]
}>()

const copied = ref(false)

const highlightedCode = computed(() => {
  if (props.language && hljs.getLanguage(props.language)) {
    return hljs.highlight(props.code, {
      language: props.language
    }).value
  }
  return hljs.highlightAuto(props.code).value
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
  <div class="code-block-wrapper group relative rounded-lg border border-gray-200 bg-gray-900 my-3">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-800 rounded-t-lg border-b border-gray-700">
      <span class="text-xs text-gray-400 font-mono">{{ language || 'text' }}</span>
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white rounded transition-colors"
        v-tooltip="copied ? '已复制' : '复制代码'"
        @click="handleCopy"
      >
        <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <svg v-else class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <pre class="p-4 overflow-x-auto"><code
      class="text-sm font-mono leading-relaxed"
      :class="`language-${language || 'plaintext'}`"
      v-html="highlightedCode"
    /></pre>
  </div>
</template>

<style>
@import 'highlight.js/styles/github-dark.css';
</style>
