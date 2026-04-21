<!--
  @component 代码块组件
  @file components/chat/CodeBlock.vue

  本组件用于渲染 AI 回复中的代码块，提供：
    1. 语法高亮（基于 highlight.js）
    2. 语言标签显示
    3. 一键复制代码功能

  使用场景：
    MarkdownRenderer 组件在渲染 AI 回复时，会将 <pre><code> 标签
    替换为本组件的实例，实现更丰富的代码展示效果。

  Props：
    - code: 代码文本内容
    - language: 编程语言标识（如 'python'、'javascript'），可选

  Events：
    - copy: 复制成功后触发，参数为复制的代码文本
-->
<script setup lang="ts">
import hljs from 'highlight.js'

const props = defineProps<{
  /** 代码文本内容 */
  code: string
  /** 编程语言标识（如 'python'、'javascript'），用于精准高亮 */
  language?: string
}>()

const emit = defineEmits<{
  /** 复制成功后触发 */
  copy: [code: string]
}>()

/** 复制状态标记，2 秒后自动重置 */
const copied = ref(false)

/**
 * 计算属性：使用 highlight.js 对代码进行语法高亮
 *
 * 如果指定了语言且 highlight.js 支持该语言，则使用指定语言高亮；
 * 否则使用自动检测模式（highlightAuto）尝试识别语言。
 */
const highlightedCode = computed(() => {
  if (props.language && hljs.getLanguage(props.language)) {
    return hljs.highlight(props.code, {
      language: props.language
    }).value
  }
  return hljs.highlightAuto(props.code).value
})

/**
 * 复制代码到剪贴板
 *
 * 使用浏览器原生 Clipboard API (navigator.clipboard.writeText)，
 * 复制成功后显示"已复制"状态，2 秒后恢复。
 */
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
  <!-- 代码块容器：深色背景 + 圆角边框 -->
  <div class="code-block-wrapper group relative rounded-lg border border-gray-200 bg-gray-900 my-3">
    <!-- 顶部工具栏：语言标签 + 复制按钮 -->
    <div class="flex items-center justify-between px-4 py-2 bg-gray-800 rounded-t-lg border-b border-gray-700">
      <!-- 显示编程语言名称 -->
      <span class="text-xs text-gray-400 font-mono">{{ language || 'text' }}</span>
      <!-- 复制按钮 -->
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white rounded transition-colors"
        @click="handleCopy"
        :title="copied ? '已复制' : '复制代码'"
      >
        <!-- 复制图标（未复制状态） -->
        <svg v-if="!copied" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <!-- 已复制图标（绿色勾） -->
        <svg v-else class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <!-- 代码内容区域，使用 v-html 渲染高亮后的 HTML -->
    <pre class="p-4 overflow-x-auto"><code
      class="text-sm font-mono leading-relaxed"
      :class="`language-${language || 'plaintext'}`"
      v-html="highlightedCode"
    /></pre>
  </div>
</template>

<!-- 引入 highlight.js 的暗色主题样式 -->
<style>
@import 'highlight.js/styles/github-dark.css';
</style>
