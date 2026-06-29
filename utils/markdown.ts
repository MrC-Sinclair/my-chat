/**
 * @file Markdown 渲染工具
 *
 * 本文件提供 Markdown 文本到 HTML 的转换功能，同时支持 LaTeX 数学公式。
 *
 * 核心挑战：
 *   Markdown 解析器（marked）不认识 LaTeX 语法，如果直接解析，
 *   $x^2$ 中的下划线 _ 会被误解析为斜体，$$ 会被误解析为其他语法。
 *
 * 解决方案 — "占位符替换"策略：
 *   1. 在 Markdown 解析之前，先把数学公式提取出来，用占位符替换
 *      $$E=mc^2$$ → %%MATHBLOCK0%%
 *      $x^2$      → %%MATHINLINE0%%
 *   2. 用 marked 解析 Markdown（此时公式已被保护，不会被误解析）
 *   3. 用 DOMPurify 清洗 HTML，防止 XSS 攻击
 *   4. 将占位符替换回数学公式的 HTML 标签
 *      %%MATHBLOCK0%% → <div class="math-block" data-formula="E=mc^2">...</div>
 *      %%MATHINLINE0%% → <span class="math-inline" data-formula="x^2">...</span>
 *   5. 后续由 katex.ts 的 renderMath 函数将公式标签渲染为可视化公式
 *
 * 依赖库：
 *   - marked：Markdown 解析器，将 Markdown 文本转为 HTML
 *   - dompurify：HTML 清洗库，过滤危险标签和属性，防止 XSS 攻击
 */

import { marked } from 'marked'
import DOMPurify from 'dompurify'

/** Markdown 渲染配置选项 */
interface MarkdownOptions {
  /** 是否将单个换行符转为 <br>（默认 true） */
  breaks?: boolean
  /** 是否启用 GitHub Flavored Markdown（表格、删除线等，默认 true） */
  gfm?: boolean
}

/** 默认配置：启用换行和 GFM 扩展 */
const defaultOptions: MarkdownOptions = {
  breaks: true,
  gfm: true
}

/**
 * 块级公式正则：匹配 $$...$$
 *
 * [\s\S]+? 非贪婪匹配任意字符（包括换行），确保多行公式也能匹配。
 * 例如：$$\int_0^1 f(x)dx$$
 */
const mathBlockRegex = /\$\$([\s\S]+?)\$\$/g

/**
 * 行内公式正则：匹配单 $...$（排除 $$ 的情况）
 *
 * (?<!\$)  前面不能是 $（排除 $$ 的情况）
 * (?!\$)   后面不能是 $（排除 $$ 的情况）
 * [^\n]+?  非贪婪匹配非换行字符（行内公式不应跨行）
 *
 * 例如：$x^2 + y^2 = r^2$
 */
const mathInlineRegex = /(?<!\$)\$(?!\$)([^\n]+?)(?<!\$)\$(?!\$)/g

/**
 * 将 Markdown 文本渲染为安全的 HTML
 *
 * @param rawText - 原始 Markdown 文本（可能包含 LaTeX 公式）
 * @param options - 渲染选项（可选）
 * @returns 清洗后的 HTML 字符串（含数学公式占位标签）
 *
 * 完整处理流程：
 *   原始文本 → 提取公式(占位符替换) → marked 解析 → DOMPurify 清洗 → 还原公式标签
 */
export function renderMarkdown(rawText: string, options?: MarkdownOptions): string {
  const opts = { ...defaultOptions, ...options }

  /** 存储提取出的代码块，防止代码块内的 $$ 被误提取为公式 */
  const codeBlocks: string[] = []
  /** 存储提取出的块级公式，下标对应占位符中的编号 */
  const mathBlocks: string[] = []
  /** 存储提取出的行内公式 */
  const mathInlines: string[] = []

  /**
   * 第零步：提取围栏代码块，用占位符替换
   *
   * 代码块内的 $$ 或 $ 不应被当作公式提取。
   * 例如 ```latex\n$$E=mc^2$$\n``` 中的 $$ 是代码内容，不是公式定界符。
   * 在 marked 解析前恢复代码块，不影响 Markdown 解析。
   */
  const fencedCodeRegex = /^(`{3,}|~{3,})(\w*)\n([\s\S]*?)\n\1$/gm
  let processedText = rawText.replace(fencedCodeRegex, (_, fence, _lang, code) => {
    const index = codeBlocks.length
    codeBlocks.push(`${fence}${_lang}\n${code}\n${fence}`)
    return `%%CODEBLOCK${index}%%`
  })

  /**
   * 第一步：提取块级公式，用占位符替换
   *
   * $$E=mc^2$$ → \n%%MATHBLOCK0%%\n
   * 前后加换行是为了让 marked 将占位符识别为独立段落
   */
  processedText = processedText.replace(mathBlockRegex, (_, formula) => {
    const index = mathBlocks.length
    mathBlocks.push(formula.trim())
    return `\n%%MATHBLOCK${index}%%\n`
  })

  /**
   * 第二步半：处理流式输出中未闭合的 $$（关键 FOUC 修复）
   *
   * 背景：流式输出时，AI 正在逐 token 输出块级公式，$$ 还没闭合。
   * 此时 mathBlockRegex 匹配不到闭合的 $$...$$，LaTeX 源码会被
   * marked 当作纯文本直接显示给用户（如 \int_0^\infty 字符），
   * 等 $$ 闭合后才变成公式，整个流式期间持续 FOUC。
   *
   * 修复：检测到未闭合的 $$ 时，把 $$ 及其后到文本末尾的内容
   * 替换为骨架屏占位符。$$ 闭合后，mathBlockRegex 会正常提取，
   * 占位符自动消失，恢复正常渲染。
   *
   * 注意：$$ 后的所有内容都会被骨架屏占位。流式输出中 $$ 一旦出现，
   * 通常就是要开始块级公式，后续内容都是公式的一部分，这是合理的。
   */
  processedText = processedText.replace(/\$\$([\s\S]*)$/, '\n%%MATHBLOCK_UNCLOSED%%\n')

  /**
   * 第三步：提取行内公式，用占位符替换
   *
   * $x^2$ → %%MATHINLINE0%%
   */
  processedText = processedText.replace(mathInlineRegex, (_, formula) => {
    const index = mathInlines.length
    mathInlines.push(formula.trim())
    return `%%MATHINLINE${index}%%`
  })

  /** 恢复代码块占位符，让 marked 正确解析代码块 */
  codeBlocks.forEach((block, index) => {
    // 必须用函数替换，不能用字符串：字符串替换中 $$ 会被解释为单个 $
    processedText = processedText.replace(`%%CODEBLOCK${index}%%`, () => block)
  })

  /**
   * 第三步：用 marked 解析 Markdown
   *
   * breaks: true → 单个换行符变为 <br>
   * gfm: true   → 支持 GFM 扩展语法（表格、删除线、任务列表等）
   */
  const html = marked.parse(processedText, {
    breaks: opts.breaks,
    gfm: opts.gfm
  }) as string

  /**
   * 第四步：用 DOMPurify 清洗 HTML，防止 XSS 攻击
   *
   * ALLOWED_TAGS：只允许安全的 HTML 标签
   *   - 基础排版：h1-h6, p, br, hr
   *   - 列表：ul, ol, li
   *   - 代码：pre, code
   *   - 格式：strong, em, b, i, u, s, del
   *   - 表格：table, thead, tbody, tr, th, td
   *   - 数学：MathML 和 SVG 标签（KaTeX 渲染需要）
   *
   * ALLOWED_ATTR：只允许安全的属性
   *   - 基础：href, target, rel, class, id, src, alt, title
   *   - SVG：viewBox, d, fill, stroke, width, height 等
   *   - MathML：xmlns, encoding, definitionURL 等
   */
  let sanitizedHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'del',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'img',
      'span',
      'div',
      'sup',
      'sub',
      'annotation',
      'semantics',
      'math',
      'mrow',
      'mi',
      'mo',
      'mspace',
      'mfrac',
      'msqrt',
      'mroot',
      'msub',
      'msup',
      'msubsup',
      'munder',
      'mover',
      'munderover',
      'mpadded',
      'mtext',
      'mn',
      'mstyle',
      'merror',
      'phantom',
      'mtable',
      'mtr',
      'mtd',
      'mlabeledtr',
      'menclose',
      'maction',
      'mglyph',
      'svg',
      'path',
      'line',
      'defs',
      'g',
      'use',
      'rect',
      'circle',
      'ellipse',
      'polygon',
      'polyline',
      'text',
      'tspan'
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'rel',
      'class',
      'id',
      'lang',
      'src',
      'alt',
      'title',
      'referrerpolicy',
      'loading',
      'xmlns',
      'viewBox',
      'd',
      'fill',
      'stroke',
      'stroke-width',
      'width',
      'height',
      'x',
      'y',
      'x1',
      'y1',
      'x2',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'points',
      'transform',
      'color',
      'display',
      'style',
      'font-size',
      'font-family',
      'encoding',
      'definitionURL',
      'href xlink:href'
    ]
  })

  sanitizedHtml = sanitizedHtml.replace(
    /<img /g,
    '<img referrerpolicy="no-referrer" loading="lazy" '
  )

  /**
   * 第五步：将占位符替换回数学公式的 HTML 标签
   *
   * 块级公式占位符可能被 marked 包裹在 <p> 标签中：
   *   <p>%%MATHBLOCK0%%</p> → <div class="math-block" ...>...</div>
   * 也可能没有 <p> 包裹（直接在文本中），所以需要处理两种情况。
   *
   * data-formula 属性存储原始 LaTeX 公式，供 katex.ts 的 renderMath 读取。
   */
  mathBlocks.forEach((formula, index) => {
    /**
     * 块级公式占位内容使用骨架屏，而非 LaTeX 源码字符。
     *
     * 历史问题：原先占位 div 内直接放 escapeHtml(formula)，导致 KaTeX JS/CSS
     * 异步加载完成前，用户会先看到 LaTeX 源码字符（如 \int_0^\infty...），
     * 加载后才替换为渲染后的公式，产生 FOUC（Flash of Unstyled Content）。
     *
     * 现改用骨架屏占位，KaTeX 渲染时 el.innerHTML 会被整体覆盖，无需手动清理。
     * 注意：行内公式因公式短、闪现不明显，保持原逻辑不动（用户要求只修块级）。
     */
    const blockPlaceholder = `<span class="math-block-placeholder" aria-label="公式加载中"></span>`
    /** 处理被 <p> 包裹的情况 */
    sanitizedHtml = sanitizedHtml.replace(
      `<p>%%MATHBLOCK${index}%%</p>`,
      `<div class="math-block" data-formula="${escapeAttr(formula)}">${blockPlaceholder}</div>`
    )
    /** 处理未被 <p> 包裹的情况 */
    sanitizedHtml = sanitizedHtml.replace(
      `%%MATHBLOCK${index}%%`,
      `<div class="math-block" data-formula="${escapeAttr(formula)}">${blockPlaceholder}</div>`
    )
  })

  /** 行内公式占位符替换为 <span> 标签 */
  mathInlines.forEach((formula, index) => {
    sanitizedHtml = sanitizedHtml.replace(
      `%%MATHINLINE${index}%%`,
      `<span class="math-inline" data-formula="${escapeAttr(formula)}">${escapeHtml(formula)}</span>`
    )
  })

  /**
   * 还原未闭合块级公式的占位符
   *
   * 流式输出中 $$ 未闭合时，用骨架屏占位 div 替换。
   * data-pending="true" 标记让 renderMath 跳过此元素，
   * 等 $$ 闭合后占位符自动消失，正常渲染。
   */
  const unclosedPlaceholder = `<div class="math-block" data-pending="true"><span class="math-block-placeholder" aria-label="公式加载中"></span></div>`
  sanitizedHtml = sanitizedHtml.replace(`<p>%%MATHBLOCK_UNCLOSED%%</p>`, unclosedPlaceholder)
  sanitizedHtml = sanitizedHtml.replace(`%%MATHBLOCK_UNCLOSED%%`, unclosedPlaceholder)

  return sanitizedHtml
}

/**
 * 转义 HTML 属性值中的特殊字符
 *
 * 防止公式中的特殊字符破坏 HTML 属性的语法结构。
 * 例如公式 a"b 中的引号需要转义为 a&quot;b
 */
function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 转义 HTML 内容中的特殊字符
 *
 * 在公式被 KaTeX 渲染之前，先以纯文本形式显示在页面上。
 * 转义确保公式中的 <、>、& 不会被浏览器当作 HTML 标签解析。
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
