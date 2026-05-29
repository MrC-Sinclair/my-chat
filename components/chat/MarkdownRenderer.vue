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
      ↓ parseSegments()   → 拆分为片段数组（文本 / 代码块 / Mermaid）
      ↓ 声明式渲染         → Vue 组件树（CodeBlock / MermaidBlock / v-html）

  Props：
    - content: AI 回复的 Markdown 原始文本
-->
<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'
import { renderMath } from '~/utils/katex'
import { defineAsyncComponent } from 'vue'

const AsyncCodeBlock = defineAsyncComponent({
  loader: () => import('./CodeBlock.vue'),
  loadingComponent: {
    template: '<div class="code-block-skeleton rounded-lg border border-gray-200 bg-gray-900 my-3 p-4"><div class="flex items-center gap-2 mb-3"><div class="h-3 w-16 bg-gray-700 rounded animate-pulse" /><div class="h-3 w-10 bg-gray-700 rounded animate-pulse ml-auto" /></div><div class="space-y-2"><div class="h-3 bg-gray-700 rounded animate-pulse w-3/4" /><div class="h-3 bg-gray-700 rounded animate-pulse w-1/2" /><div class="h-3 bg-gray-700 rounded animate-pulse w-2/3" /></div></div>'
  },
  errorComponent: {
    props: ['error', 'retry'],
    template: '<div class="async-error rounded-lg border border-red-200 bg-red-50 my-3 p-4"><div class="flex items-center gap-2 mb-2"><svg class="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span class="text-sm text-red-700 font-medium">代码块加载失败</span></div><button @click="retry" class="text-xs text-red-600 hover:text-red-800 underline underline-offset-2 transition-colors duration-150">点击重试</button></div>'
  }
})

const AsyncMermaidBlock = defineAsyncComponent({
  loader: () => import('./MermaidBlock.vue'),
  loadingComponent: {
    template: '<div class="mermaid-skeleton rounded-lg border border-gray-200 bg-white my-3 p-4"><div class="flex items-center gap-2 mb-3"><div class="h-3 w-16 bg-gray-200 rounded animate-pulse" /><div class="h-3 w-10 bg-gray-200 rounded animate-pulse ml-auto" /></div><div class="h-20 bg-gray-100 rounded animate-pulse flex items-center justify-center"><span class="text-xs text-gray-400">图表加载中…</span></div></div>'
  },
  errorComponent: {
    props: ['error', 'retry'],
    template: '<div class="async-error rounded-lg border border-red-200 bg-red-50 my-3 p-4"><div class="flex items-center gap-2 mb-2"><svg class="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span class="text-sm text-red-700 font-medium">图表加载失败</span></div><button @click="retry" class="text-xs text-red-600 hover:text-red-800 underline underline-offset-2 transition-colors duration-150">点击重试</button></div>'
  }
})

const props = defineProps<{
  content: string
}>()

const containerRef = ref<HTMLElement | null>(null)

/** 渲染片段类型 */
interface TextSegment {
  type: 'text'
  html: string
}

interface CodeSegment {
  type: 'code'
  language: string
  code: string
}

interface MermaidSegment {
  type: 'mermaid'
  source: string
}

type Segment = TextSegment | CodeSegment | MermaidSegment

/**
 * 将 Markdown HTML 拆分为片段数组
 *
 * 策略：先渲染完整 HTML，然后提取所有 <pre> 代码块，
 * 将 HTML 拆分为"文本段"和"代码段"交替的数组。
 * 代码段使用声明式 Vue 组件渲染，避免 createApp 的重复创建开销。
 */
function parseSegments(html: string): Segment[] {
  const segments: Segment[] = []

  // 统一用一次遍历处理所有代码块
  const allBlocks: { start: number; end: number; lang: string; code: string }[] = []

  // 匹配所有 <pre><code> 块
  const preCodeRegex = /<pre><code(?: class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g
  let match: RegExpExecArray | null

  while ((match = preCodeRegex.exec(html)) !== null) {
    const lang = match[1] || ''
    const codeHtml = match[2]
    // HTML 实体解码
    const code = decodeHtml(codeHtml)
    allBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      lang,
      code
    })
  }

  let lastEnd = 0
  for (const block of allBlocks) {
    // 代码块之前的文本
    if (block.start > lastEnd) {
      const textHtml = html.slice(lastEnd, block.start)
      if (textHtml.trim()) {
        segments.push({ type: 'text', html: textHtml })
      }
    }

    if (block.lang === 'mermaid') {
      segments.push({ type: 'mermaid', source: block.code })
    } else {
      segments.push({ type: 'code', language: block.lang, code: block.code })
    }

    lastEnd = block.end
  }

  // 最后一段文本
  if (lastEnd < html.length) {
    const textHtml = html.slice(lastEnd)
    if (textHtml.trim()) {
      segments.push({ type: 'text', html: textHtml })
    }
  }

  // 如果没有代码块，整段作为文本
  if (segments.length === 0 && html.trim()) {
    segments.push({ type: 'text', html })
  }

  return segments
}

/** 解码 HTML 实体 */
function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
}

/** 使用 shallowRef 避免对大型 HTML 字符串做深层响应式追踪 */
const segments = shallowRef<Segment[]>([])

/** 是否正在流式输出（内容稳定后设为 false，Mermaid 延迟到稳定后再渲染） */
const isStreaming = ref(false)

let rafId: number | null = null
/** 初始化为 null 确保 onMounted 中首次 doRender 不会被跳过 */
let lastRenderedContent: string | null = null
let contentStableTimer: ReturnType<typeof setTimeout> | null = null

function doRender() {
  if (props.content === lastRenderedContent) return
  lastRenderedContent = props.content

  // 内容变化说明还在流式输出
  isStreaming.value = true

  const html = renderMarkdown(props.content)
  segments.value = parseSegments(html)

  nextTick(() => {
    try {
      if (containerRef.value) {
        renderTables()
        renderImages()
        renderMath(containerRef.value).catch((e) => {
          console.error('MarkdownRenderer 数学公式渲染失败:', e)
        })
      }
    } catch (e) {
      console.error('MarkdownRenderer 后处理渲染失败:', e)
    }
  })
}

function scheduleRender() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    try {
      doRender()
    } catch (e) {
      console.error('MarkdownRenderer 调度渲染失败:', e)
    }
  })
}

watch(
  () => props.content,
  () => {
    try {
      if (contentStableTimer) {
        clearTimeout(contentStableTimer)
      }

      scheduleRender()

      // 内容稳定后标记流式输出结束，重新渲染数学公式
      contentStableTimer = setTimeout(() => {
        contentStableTimer = null
        isStreaming.value = false
        nextTick(() => {
          if (containerRef.value) {
            renderMath(containerRef.value).catch((e) => {
              console.error('MarkdownRenderer 数学公式渲染失败:', e)
            })
          }
        })
      }, 1500)
    } catch (e) {
      console.error('MarkdownRenderer watch 回调失败:', e)
    }
  },
)

// 在 setup 阶段预初始化 segments，确保初次渲染即包含内容
doRender()

onMounted(() => {
  doRender()
})

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (contentStableTimer) {
    clearTimeout(contentStableTimer)
    contentStableTimer = null
  }
})

/** 放大查看的图片 URL */
const lightboxSrc = ref('')

/** 打开图片放大查看 */
function openLightbox(src: string) {
  lightboxSrc.value = src
}

/** 关闭图片放大查看 */
function closeLightbox() {
  lightboxSrc.value = ''
}

/**
 * 为容器内的 <table> 添加滚动包装
 */
function renderTables() {
  if (!containerRef.value) return
  const tables = containerRef.value.querySelectorAll('table')
  tables.forEach((table) => {
    if (table.parentElement?.classList.contains('table-wrapper')) return
    const wrapper = document.createElement('div')
    wrapper.className = 'table-wrapper'
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })
}

function renderImages() {
  if (!containerRef.value) return

  const images = containerRef.value.querySelectorAll('img')
  images.forEach((img) => {
    if (img.dataset.imgProcessed) return
    img.dataset.imgProcessed = 'true'

    img.referrerPolicy = 'no-referrer'

    img.addEventListener('load', () => {
      img.classList.add('img-loaded')
    })

    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('img-loaded')
    }

    img.addEventListener('error', () => {
      if (img.parentElement?.classList.contains('img-error')) return
      const fallback = document.createElement('div')
      fallback.className = 'img-error'
      fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> 图片加载失败`
      const altText = img.alt || img.src
      if (altText) {
        const altSpan = document.createElement('span')
        altSpan.style.opacity = '0.7'
        altSpan.textContent = `(${altText})`
        fallback.appendChild(altSpan)
      }
      img.replaceWith(fallback)
    })

    img.addEventListener('click', () => {
      if (img.src) openLightbox(img.src)
    })
  })
}
</script>

<template>
  <div ref="containerRef" class="markdown-body prose prose-sm max-w-none">
    <template v-for="(seg, i) in segments" :key="i">
      <!-- 文本片段：v-html 渲染（含公式占位符、表格、图片等） -->
      <div v-if="seg.type === 'text'" v-html="seg.html" />
      <!-- 代码块：声明式组件，Vue 自动管理生命周期 -->
      <AsyncCodeBlock v-else-if="seg.type === 'code'" :code="seg.code" :language="seg.language" />
      <!-- Mermaid 图表：流式输出期间显示占位符，稳定后再渲染 -->
      <div v-else-if="seg.type === 'mermaid' && isStreaming" class="mermaid-pending">⏳ Mermaid 图表将在输出完成后渲染…</div>
      <AsyncMermaidBlock v-else-if="seg.type === 'mermaid'" :source="seg.source" />
    </template>
  </div>

  <Teleport to="body">
    <Transition name="fade">
      <div v-if="lightboxSrc" class="img-lightbox" @click="closeLightbox">
        <img :src="lightboxSrc" alt="放大查看" @click.stop />
      </div>
    </Transition>
  </Teleport>
</template>

<!-- 组件样式：Markdown 排版 -->
<style>

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
.markdown-body .table-wrapper {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 1em 0;
}

.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
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

/** 图片响应式样式 + 加载占位骨架屏 */
.markdown-body img {
  max-width: 100%;
  height: auto;
  min-height: 180px;
  border-radius: 8px;
  margin: 0.6em 0;
  cursor: zoom-in;
  opacity: 0;
  transition: opacity 0.3s ease;
  background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
  background-size: 200% 100%;
  animation: img-shimmer 1.5s ease-in-out infinite;
}

.markdown-body img.img-loaded {
  opacity: 1;
  min-height: 0;
  background: none;
  animation: none;
}

.markdown-body img.img-loaded:hover {
  opacity: 0.92;
}

@keyframes img-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
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
  color: #7c3aed;
}

/** 块级公式（$$...$$）样式：允许横向滚动 */
.markdown-body .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.5em 0;
  margin: 0.8em 0;
}

/** 图片加载失败容错样式 */
.markdown-body .img-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 0.85em;
  margin: 0.6em 0;
}

/** 图片放大遮罩层 */
.img-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  cursor: zoom-out;
  animation: lightbox-fade-in 0.2s ease;
}

.img-lightbox img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

@keyframes lightbox-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/** 行内公式字体略大 */
.markdown-body .katex {
  font-size: 1.05em;
}
</style>
