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
 * 渲染单个公式元素
 *
 * @param katex - KaTeX 模块实例
 * @param el - 公式占位符元素（.math-block 或 .math-inline）
 *
 * 渲染后标记 data-katex-rendered 属性，避免重复渲染。
 */
function renderSingleFormula(katex: typeof KatexType, el: HTMLElement): void {
  if (el.hasAttribute('data-katex-rendered')) return
  /** 流式输出中未闭合的块级公式（$$ 还没闭合），跳过渲染 */
  if (el.hasAttribute('data-pending')) return

  const formula = el.dataset.formula || el.textContent || ''
  const isBlock = el.classList.contains('math-block')

  try {
    el.innerHTML = katex.renderToString(formula, {
      displayMode: isBlock,
      throwOnError: false,
      errorColor: '#cc0000'
    })
    if (isBlock) el.classList.add('katex-display')
    el.setAttribute('data-katex-rendered', 'true')
  } catch (err) {
    console.error(`KaTeX ${isBlock ? '块级' : '行内'}公式渲染失败:`, err, formula)
  }
}

/** 公式数量较少时直接全量渲染的阈值，避免 observer 开销 */
const LAZY_RENDER_THRESHOLD = 5

/** IntersectionObserver 预渲染距离（视口外 200px 即开始渲染） */
const OBSERVER_ROOT_MARGIN = '200px 0px'

/**
 * 渲染 DOM 元素中的数学公式占位符（支持 IntersectionObserver 延迟渲染）
 *
 * 优化策略：
 *   1. 跳过已渲染的公式（data-katex-rendered 属性）
 *   2. 公式数量 ≤ LAZY_RENDER_THRESHOLD 时全量渲染（observer 开销不值得）
 *   3. 公式数量多时，视口内的立即渲染，视口外的用 IntersectionObserver 延迟渲染
 *   4. 返回 cleanup 函数，调用方可断开 observer
 *
 * @param element - 包含数学公式占位符的 DOM 容器元素
 * @returns cleanup 函数，断开 IntersectionObserver
 */
export async function renderMath(element: HTMLElement): Promise<() => void> {
  if (typeof window === 'undefined') return () => {}

  const katex = await loadKatex()

  const blockElements = element.querySelectorAll('.math-block')
  const inlineElements = element.querySelectorAll('.math-inline')

  const allElements = [...blockElements, ...inlineElements] as HTMLElement[]

  const unrendered = allElements.filter((el) => !el.hasAttribute('data-katex-rendered'))

  if (unrendered.length === 0) return () => {}

  if (unrendered.length <= LAZY_RENDER_THRESHOLD) {
    unrendered.forEach((el) => renderSingleFormula(katex, el))
    return () => {}
  }

  let observer: IntersectionObserver | null = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          renderSingleFormula(katex, entry.target as HTMLElement)
          observer?.unobserve(entry.target)
        }
      })
    },
    { rootMargin: OBSERVER_ROOT_MARGIN }
  )

  unrendered.forEach((el) => {
    const rect = el.getBoundingClientRect()
    const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200

    if (isVisible) {
      renderSingleFormula(katex, el)
    } else {
      observer!.observe(el)
    }
  })

  const cleanup = () => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  }

  return cleanup
}
