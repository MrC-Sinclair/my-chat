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
 */

import katex from 'katex'

/**
 * 渲染 DOM 元素中的数学公式占位符
 *
 * 本函数在 Markdown 渲染完成后调用，查找所有 .math-block 和 .math-inline 元素，
 * 读取其 data-formula 属性中的 LaTeX 公式文本，用 KaTeX 渲染后替换元素内容。
 *
 * @param element - 包含数学公式占位符的 DOM 容器元素
 *
 * 处理流程：
 *   1. 查找所有 .math-block 元素 → 渲染为块级公式（displayMode: true）
 *   2. 查找所有 .math-inline 元素 → 渲染为行内公式（displayMode: false）
 *
 * 错误处理：
 *   throwOnError: false 表示公式语法错误时不抛异常，
 *   而是在页面上以红色文字显示错误信息（errorColor: '#cc0000'）。
 */
export function renderMath(element: HTMLElement): void {
  /** 处理块级公式（$$...$$） */
  const blockElements = element.querySelectorAll('.math-block')
  /** 处理行内公式（$...$） */
  const inlineElements = element.querySelectorAll('.math-inline')

  blockElements.forEach((el) => {
    /** 从 data-formula 属性中获取原始 LaTeX 公式文本 */
    const formula = (el as HTMLElement).dataset.formula || el.textContent || ''
    try {
      el.innerHTML = katex.renderToString(formula, {
        /** displayMode: true 表示块级模式，公式居中显示 */
        displayMode: true,
        /** 不抛出异常，而是在页面上显示错误 */
        throwOnError: false,
        /** 公式语法错误时的文字颜色 */
        errorColor: '#cc0000'
      })
      /** 添加 katex-display 类，用于 CSS 样式（如横向滚动） */
      el.classList.add('katex-display')
    } catch (err) {
      console.error('KaTeX 块级公式渲染失败:', err, formula)
    }
  })

  inlineElements.forEach((el) => {
    const formula = (el as HTMLElement).dataset.formula || el.textContent || ''
    try {
      el.innerHTML = katex.renderToString(formula, {
        /** displayMode: false 表示行内模式，公式嵌入文本中 */
        displayMode: false,
        throwOnError: false,
        errorColor: '#cc0000'
      })
    } catch (err) {
      console.error('KaTeX 行内公式渲染失败:', err, formula)
    }
  })
}
