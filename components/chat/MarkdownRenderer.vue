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
import { createApp, type App as VueApp } from 'vue'
import { renderMarkdown } from '~/utils/markdown'
import { renderMath } from '~/utils/katex'
import CodeBlock from './CodeBlock.vue'
import MermaidBlock from './MermaidBlock.vue'

const props = defineProps<{
  content: string
}>()

const containerRef = ref<HTMLElement | null>(null)

const htmlContent = computed(() => renderMarkdown(props.content))

const mountedApps = new Map<HTMLElement, VueApp>()

let contentStableTimer: ReturnType<typeof setTimeout> | null = null

function cleanupMountedApps() {
  if (!containerRef.value) return
  const currentWrappers = new Set(containerRef.value.querySelectorAll('[data-vue-mounted]'))
  const keysToDelete: HTMLElement[] = []
  for (const [wrapper, app] of mountedApps) {
    if (!currentWrappers.has(wrapper) || !document.contains(wrapper)) {
      try {
        app.unmount()
      } catch {
        /* 已销毁的实例忽略 */
      }
      keysToDelete.push(wrapper)
    }
  }
  keysToDelete.forEach((key) => mountedApps.delete(key))
}

function renderCodeBlocks(renderMermaid = true) {
  if (!containerRef.value) return

  cleanupMountedApps()

  const preElements = containerRef.value.querySelectorAll('pre > code')
  preElements.forEach((codeEl) => {
    const preEl = codeEl.parentElement
    if (!preEl) return

    const language =
      Array.from(codeEl.classList)
        .find((cls) => cls.startsWith('language-'))
        ?.replace('language-', '') || ''

    const codeText = codeEl.textContent || ''

    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-vue-mounted', 'true')
    preEl.replaceWith(wrapper)

    if (language === 'mermaid') {
      if (renderMermaid) {
        const app = createApp(MermaidBlock, { source: codeText })
        app.mount(wrapper)
        mountedApps.set(wrapper, app)
      } else {
        wrapper.setAttribute('data-mermaid-source', codeText)
        wrapper.innerHTML = '<div class="mermaid-pending">⏳ Mermaid 图表将在输出完成后渲染…</div>'
      }
    } else {
      const app = createApp(CodeBlock, { code: codeText, language })
      app.mount(wrapper)
      mountedApps.set(wrapper, app)
    }
  })
}

function renderPendingMermaidBlocks() {
  if (!containerRef.value) return
  const pendingWrappers = containerRef.value.querySelectorAll('[data-mermaid-source]')
  pendingWrappers.forEach((wrapper) => {
    const source = wrapper.getAttribute('data-mermaid-source') || ''
    wrapper.removeAttribute('data-mermaid-source')
    wrapper.innerHTML = ''
    const app = createApp(MermaidBlock, { source })
    app.mount(wrapper)
    mountedApps.set(wrapper as HTMLElement, app)
  })
}

watch(
  () => props.content,
  () => {
    if (contentStableTimer) {
      clearTimeout(contentStableTimer)
    }

    nextTick(() => {
      if (containerRef.value) {
        renderCodeBlocks(false)
        renderTables()
        renderImages()
        renderMath(containerRef.value)
      }
    })

    contentStableTimer = setTimeout(() => {
      contentStableTimer = null
      nextTick(() => {
        renderPendingMermaidBlocks()
      })
    }, 1500)
  },
  { immediate: true }
)

onMounted(() => {
  if (containerRef.value) {
    renderCodeBlocks(true)
    renderTables()
    renderImages()
    renderMath(containerRef.value)
  }
})

onUnmounted(() => {
  if (contentStableTimer) {
    clearTimeout(contentStableTimer)
  }
  for (const [, app] of mountedApps) {
    try {
      app.unmount()
    } catch {
      /* 已销毁的实例忽略 */
    }
  }
  mountedApps.clear()
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
 * 为容器内的 <img> 标签添加容错处理和点击放大
 *
 * 由于内容通过 v-html 渲染，无法使用 Vue 的事件绑定，
 * 需要在 DOM 更新后手动为图片添加事件监听器。
 *
 * 处理内容：
 *   1. onerror — 图片加载失败时替换为友好提示
 *   2. onclick — 点击图片打开放大查看
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
  <!--
    渲染容器：
    - v-html 将 Markdown 转换的 HTML 插入 DOM
    - prose 类来自 Tailwind Typography 插件，提供排版美化
    - ref="containerRef" 用于获取 DOM 引用进行后处理
  -->
  <div ref="containerRef" class="markdown-body prose prose-sm max-w-none" v-html="htmlContent" />

  <Teleport to="body">
    <Transition name="fade">
      <div v-if="lightboxSrc" class="img-lightbox" @click="closeLightbox">
        <img :src="lightboxSrc" alt="放大查看" @click.stop />
      </div>
    </Transition>
  </Teleport>
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

.markdown-body .mermaid-pending {
  padding: 16px;
  text-align: center;
  color: #9ca3af;
  font-size: 0.85em;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
  margin: 1em 0;
  animation: pulse 1.5s ease-in-out infinite;
}
</style>
