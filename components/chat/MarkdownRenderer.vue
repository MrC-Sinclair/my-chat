<!--
  @component Markdown 渲染组件
  @file components/chat/MarkdownRenderer.vue

  本组件是 AI 回复的核心渲染器，负责将 Markdown 文本转换为富文本 HTML。
  它整合了三种渲染能力：
    1. Markdown → HTML（通过 marked 库）
    2. LaTeX 数学公式 → 可视化公式（通过 KaTeX 库）
    3. 代码块 → 带语法高亮的交互式代码块（通过 CodeBlock 组件）

  渲染流程：
    AI 回复文本
      ↓ renderMarkdown()  → 基础 HTML（含占位符）
      ↓ v-html 渲染       → DOM 树
      ↓ renderCodeBlocks() → 将 <pre><code> 替换为 CodeBlock 组件
      ↓ renderMath()       → 将数学占位符替换为 KaTeX 渲染结果

  Props：
    - content: AI 回复的 Markdown 原始文本
-->
<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'
import { renderMath } from '~/utils/katex'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{
  /** AI 回复的 Markdown 原始文本 */
  content: string
}>()

/** 容器 DOM 引用，用于后续的 DOM 操作（替换代码块、渲染公式） */
const containerRef = ref<HTMLElement | null>(null)

/** 将 Markdown 文本转换为 HTML（含数学公式占位符） */
const htmlContent = computed(() => renderMarkdown(props.content))

/**
 * 监听 content 变化，在 DOM 更新后执行后处理
 *
 * 为什么需要 nextTick？
 *   Vue 的 v-html 更新是异步的，必须等 DOM 更新完成后
 *   才能操作 DOM 元素（替换代码块、渲染公式）。
 *
 * immediate: true 表示组件初始化时也立即执行一次。
 */
watch(
  () => props.content,
  () => {
    nextTick(() => {
      if (containerRef.value) {
        renderCodeBlocks()
        renderMath(containerRef.value)
      }
    })
  },
  { immediate: true }
)

/** 组件挂载后执行首次渲染 */
onMounted(() => {
  if (containerRef.value) {
    renderCodeBlocks()
    renderMath(containerRef.value)
  }
})

/**
 * 将 <pre><code> 标签替换为 CodeBlock Vue 组件
 *
 * marked 生成的代码块是普通的 <pre><code> HTML 标签，
 * 没有语法高亮和复制功能。本函数遍历所有代码块元素，
 * 用 Vue 的 createApp 动态创建 CodeBlock 组件实例来替换它们。
 *
 * 步骤：
 *   1. 找到容器内所有 <pre><code> 元素
 *   2. 从 class 中提取语言标识（如 "language-python"）
 *   3. 创建一个 div 包装器替换原来的 <pre> 元素
 *   4. 用 createApp(CodeBlock, { code, language }) 挂载到包装器上
 */
function renderCodeBlocks() {
  if (!containerRef.value) return

  const preElements = containerRef.value.querySelectorAll('pre > code')
  preElements.forEach((codeEl) => {
    const preEl = codeEl.parentElement
    if (!preEl) return

    // 从 class="language-python" 中提取 "python"
    const language = Array.from(codeEl.classList)
      .find((cls) => cls.startsWith('language-'))
      ?.replace('language-', '') || ''

    const codeText = codeEl.textContent || ''

    // 创建包装 div 并替换原来的 <pre> 元素
    const wrapper = document.createElement('div')
    preEl.replaceWith(wrapper)

    // 动态创建 CodeBlock 组件实例并挂载
    const app = createApp(CodeBlock, { code: codeText, language })
    app.mount(wrapper)
  })
}
</script>

<template>
  <!--
    渲染容器：
    - v-html 将 Markdown 转换的 HTML 插入 DOM
    - prose 类来自 Tailwind Typography 插件，提供排版美化
    - ref="containerRef" 用于获取 DOM 引用进行后处理
  -->
  <div
    ref="containerRef"
    class="markdown-body prose prose-sm max-w-none"
    v-html="htmlContent"
  />
</template>

<!-- 组件样式：Markdown 排版 + KaTeX 公式样式 -->
<style>
/** 引入 KaTeX 的基础样式 */
@import 'katex/dist/katex.min.css';

/** Markdown 正文排版 */
.markdown-body {
  line-height: 1.7;
  word-wrap: break-word;
}

/** 标题样式 */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin-top: 1.2em;
  margin-bottom: 0.6em;
  font-weight: 600;
  line-height: 1.4;
}

/** 段落间距 */
.markdown-body p {
  margin-bottom: 0.8em;
}

/** 列表缩进和间距 */
.markdown-body ul,
.markdown-body ol {
  padding-left: 1.5em;
  margin-bottom: 0.8em;
}

.markdown-body li {
  margin-bottom: 0.3em;
}

/** 引用块样式：左侧竖线 + 灰色背景 */
.markdown-body blockquote {
  border-left: 4px solid #ddd;
  padding-left: 1em;
  margin: 0.8em 0;
  color: #666;
  background: #f9f9f9;
  border-radius: 0 4px 4px 0;
  padding: 0.5em 1em;
}

/** 表格样式 */
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid #ddd;
  padding: 8px 12px;
  text-align: left;
}

.markdown-body th {
  background: #f5f5f5;
  font-weight: 600;
}

/** 链接样式 */
.markdown-body a {
  color: #2563eb;
  text-decoration: underline;
}

.markdown-body a:hover {
  color: #1d4ed8;
}

/** 行内代码样式（非代码块中的 `code`） */
.markdown-body code:not(pre code) {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.875em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #e11d48;
}

/** 块级公式（$$...$$）样式：允许横向滚动 */
.markdown-body .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.5em 0;
  margin: 0.8em 0;
}

/** 行内公式字体略大 */
.markdown-body .katex {
  font-size: 1.05em;
}
</style>
