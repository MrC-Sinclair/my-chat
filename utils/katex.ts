/**
 * @file KaTeX 数学公式渲染工具
 *
 * 本文件提供数学公式的渲染功能，将 LaTeX 格式的公式转换为可视化数学符号。
 *
 * 为什么需要单独处理数学公式？
 *   Markdown 解析器（marked）不认识 LaTeX 语法（$...$ 和 $$...$$），
 *   所以在 markdown.ts 中，公式会被先替换为占位符（如 <div class="math-block">），
 *   等 Markdown 渲染完成后，再由本文件中的 renderMath 函数将占位符替换为
 *   KaTeX 渲染的数学公式。
 *
 * KaTeX vs MathJax：
 *   - KaTeX：渲染速度快（服务端无依赖），适合实时预览
 *   - MathJax：功能更全，但渲染较慢
 *   本项目选择 KaTeX 以获得更好的实时体验
 *
 * 支持的公式格式：
 *   - 块级公式：$$E = mc^2$$  → 居中显示的大公式
 *   - 行内公式：$x^2 + y^2 = r^2$  → 嵌入文本中的小公式
 *
 * 性能优化：
 *   KaTeX JS 和 CSS 均为动态加载，不在首屏同步引入。
 *   首次调用 renderMath 时才加载，后续调用使用缓存的模块实例。
 */

import type KatexType from 'katex'

/** 缓存已加载的 KaTeX 模块实例 */
let katexCache: typeof KatexType | null = null

/** 标记 KaTeX CSS 是否已注入 */
let cssInjected = false

/**
 * 动态加载 KaTeX 模块和 CSS
 *
 * 首次调用时动态 import KaTeX JS 并注入 CSS <link> 标签，
 * 后续调用直接返回缓存的模块实例。
 */
async function loadKatex(): Promise<typeof KatexType> {
  if (katexCache) return katexCache

  const katexModule = await import('katex')
  katexCache = katexModule.default

  if (!cssInjected && typeof window !== 'undefined') {
    await injectKatexCss()
  }

  return katexCache
}

/**
 * 动态注入 KaTeX CSS
 *
 * 通过创建 <link> 标签注入 katex.min.css，等待 onload 后再返回，
 * 避免公式渲染时 CSS 未加载完成导致无样式闪烁。
 */
function injectKatexCss(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cssInjected = true
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'
    link.onload = () => {
      cssInjected = true
      resolve()
    }
    link.onerror = () => {
      console.error('KaTeX CSS 加载失败')
      resolve()
    }
    document.head.appendChild(link)

    // jsdom 等 DOM 模拟环境中 <link> 的 onload 不会触发，设置超时避免永久挂起
    setTimeout(() => {
      if (!cssInjected) {
        cssInjected = true
        resolve()
      }
    }, 100)
  })
}

/**
 * 渲染 DOM 元素中的数学公式占位符
 *
 * 本函数在 Markdown 渲染完成后调用，查找所有 .math-block 和 .math-inline 元素，
 * 读取其 data-formula 属性中的 LaTeX 公式文本，用 KaTeX 渲染后替换元素内容。
 *
 * @param element - 包含数学公式占位符的 DOM 容器元素
 *
 * 处理流程：
 *   1. 动态加载 KaTeX 模块和 CSS
 *   2. 查找所有 .math-block 元素 → 渲染为块级公式（displayMode: true）
 *   3. 查找所有 .math-inline 元素 → 渲染为行内公式（displayMode: false）
 *
 * 错误处理：
 *   throwOnError: false 表示公式语法错误时不抛异常，
 *   而是在页面上以红色文字显示错误信息（errorColor: '#cc0000'）。
 */
export async function renderMath(element: HTMLElement): Promise<void> {
  if (typeof window === 'undefined') return

  const katex = await loadKatex()

  /** 处理块级公式（$$...$$） */
  const blockElements = element.querySelectorAll('.math-block')
  /** 处理行内公式（$...$） */
  const inlineElements = element.querySelectorAll('.math-inline')

  blockElements.forEach((el) => {
    const formula = (el as HTMLElement).dataset.formula || el.textContent || ''
    try {
      el.innerHTML = katex.renderToString(formula, {
        displayMode: true,
        throwOnError: false,
        errorColor: '#cc0000'
      })
      el.classList.add('katex-display')
    } catch (err) {
      console.error('KaTeX 块级公式渲染失败:', err, formula)
    }
  })

  inlineElements.forEach((el) => {
    const formula = (el as HTMLElement).dataset.formula || el.textContent || ''
    try {
      el.innerHTML = katex.renderToString(formula, {
        displayMode: false,
        throwOnError: false,
        errorColor: '#cc0000'
      })
    } catch (err) {
      console.error('KaTeX 行内公式渲染失败:', err, formula)
    }
  })
}
