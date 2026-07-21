## Requirements

### Requirement: Markdown 渲染管线占位符替换策略

`utils/markdown.ts` 的 `renderMarkdown(rawText, options?)` SHALL 采用「占位符替换」策略渲染 Markdown，按以下顺序处理：1) 提取围栏代码块（``` 或 ~~~）为 `%%CODEBLOCK{n}%%` 占位符，避免代码块内的 `$` 被误提取为公式；2) 提取块级公式 `$$...$$` 为 `%%MATHBLOCK{n}%%` 占位符（前后加换行以便 marked 识别为独立段落）；3) 检测流式未闭合的 `$$`，将 `$$` 及其后到文本末尾的内容替换为 `%%MATHBLOCK_UNCLOSED%%` 占位符；4) 提取行内公式 `$...$` 为 `%%MATHINLINE{n}%%` 占位符（正则用 `(?<!\$)\$(?!\$)` 排除 `$$` 情况，且不跨行）；5) 恢复代码块占位符后调用 `marked.parse()` 解析 Markdown（启用 `breaks: true` 和 `gfm: true`）；6) 调用 `DOMPurify.sanitize()` 清洗 HTML；7) 自动为 `<img>` 标签注入 `referrerpolicy="no-referrer"` 和 `loading="lazy"` 属性；8) 将 `%%MATHBLOCK{n}%%` 替换回 `<div class="math-block" data-formula="...">` 标签（含骨架屏占位），`%%MATHINLINE{n}%%` 替换回 `<span class="math-inline" data-formula="...">` 标签，`%%MATHBLOCK_UNCLOSED%%` 替换为带 `data-pending="true"` 的占位 div。代码块占位符恢复 MUST 使用函数替换（`replace(pattern, () => block)`），不可用字符串替换（字符串替换中 `$$` 会被解释为单个 `$`）。

#### Scenario: 普通文本渲染

- **WHEN** 调用 `renderMarkdown("# 标题\n\n正文段落")`
- **THEN** 返回包含 `<h1>标题</h1>` 和 `<p>正文段落</p>` 的安全 HTML
- **AND** HTML 已经过 DOMPurify 清洗

#### Scenario: 代码块内的 $$ 不被误提取为公式

- **WHEN** 调用 `renderMarkdown("```latex\n$$E=mc^2$$\n```")`
- **THEN** 代码块内的 `$$E=mc^2$$` 被视为代码内容，不被提取为块级公式占位符
- **AND** 渲染结果为 `<pre><code class="language-latex">` 包裹的代码块

#### Scenario: 块级公式占位符替换

- **WHEN** 调用 `renderMarkdown("$$E=mc^2$$")`
- **THEN** 返回的 HTML 包含 `<div class="math-block" data-formula="E=mc^2">` 标签
- **AND** 标签内部为骨架屏占位 `<span class="math-block-placeholder">`，不直接暴露 LaTeX 源码

#### Scenario: 行内公式占位符替换

- **WHEN** 调用 `renderMarkdown("公式 $x^2 + y^2 = r^2$ 结束")`
- **THEN** 返回的 HTML 包含 `<span class="math-inline" data-formula="x^2 + y^2 = r^2">` 标签

#### Scenario: 自动注入图片安全属性

- **WHEN** Markdown 中包含 `![alt](https://example.com/img.png)`
- **THEN** 渲染后的 `<img>` 标签 MUST 包含 `referrerpolicy="no-referrer"` 和 `loading="lazy"` 属性

### Requirement: DOMPurify 白名单包含 MathML 和 SVG 标签

`renderMarkdown()` 调用 `DOMPurify.sanitize()` 时 SHALL 通过 `ALLOWED_TAGS` 显式指定白名单，MUST 包含以下三类标签：

- **基础排版/列表/表格/格式标签**：`h1`-`h6`、`p`、`br`、`hr`、`ul`、`ol`、`li`、`blockquote`、`pre`、`code`、`a`、`strong`、`em`、`b`、`i`、`u`、`s`、`del`、`table`、`thead`、`tbody`、`tr`、`th`、`td`、`img`、`span`、`div`、`sup`、`sub`
- **MathML 标签**（KaTeX 渲染必需）：`annotation`、`semantics`、`math`、`mrow`、`mi`、`mo`、`mspace`、`mfrac`、`msqrt`、`mroot`、`msub`、`msup`、`msubsup`、`munder`、`mover`、`munderover`、`mpadded`、`mtext`、`mn`、`mstyle`、`merror`、`phantom`、`mtable`、`mtr`、`mtd`、`mlabeledtr`、`menclose`、`maction`、`mglyph`
- **SVG 标签**（KaTeX 渲染必需）：`svg`、`path`、`line`、`defs`、`g`、`use`、`rect`、`circle`、`ellipse`、`polygon`、`polyline`、`text`、`tspan`

`ALLOWED_ATTR` MUST 包含基础属性（`href`、`target`、`rel`、`class`、`id`、`lang`、`src`、`alt`、`title`、`referrerpolicy`、`loading`、`style`、`color`、`display`、`font-size`、`font-family`）、SVG 属性（`xmlns`、`viewBox`、`d`、`fill`、`stroke`、`stroke-width`、`width`、`height`、`x`、`y`、`x1`、`y1`、`x2`、`y2`、`cx`、`cy`、`r`、`rx`、`ry`、`points`、`transform`）和 MathML 属性（`encoding`、`definitionURL`、`href xlink:href`）。

**关键约束**：DOMPurify 白名单变更 MUST 同步包含 MathML 和 SVG 标签，否则 KaTeX 渲染的公式 HTML 会被过滤掉。

#### Scenario: KaTeX 块级公式 HTML 不被过滤

- **WHEN** `renderMarkdown("$$\\int_0^1 f(x)dx$$")` 返回的 HTML 被 DOMPurify 清洗后
- **THEN** `<div class="math-block">` 标签及内部 `data-formula` 属性保留
- **AND** 后续 KaTeX 渲染生成的 `<math>`、`<mrow>`、`<mi>`、`<mo>`、`<mfrac>` 等 MathML 标签和 `<svg>`、`<path>` 等 SVG 标签不会被过滤

#### Scenario: 危险标签被过滤

- **WHEN** Markdown 文本中注入 `<script>alert(1)</script>` 或 `<iframe>` 等危险标签
- **THEN** DOMPurify 清洗后这些标签被移除
- **AND** 返回的 HTML 不含任何 `<script>`、`<iframe>`、`<object>`、`<embed>` 标签

### Requirement: 流式 FOUC 修复

`renderMarkdown()` 和 `utils/katex.ts` SHALL 通过以下机制避免流式输出期间的 FOUC（Flash of Unstyled Content）：

- **未闭合 `$$` 骨架屏占位**：检测到流式输出中未闭合的 `$$`（正则 `/\$\$([\s\S]*)$/`）时，将 `$$` 及其后内容替换为 `%%MATHBLOCK_UNCLOSED%%` 占位符，最终渲染为 `<div class="math-block" data-pending="true">` 包裹的骨架屏，而非 LaTeX 源码字符。`renderMath()` 跳过带 `data-pending` 属性的元素。`$$` 闭合后 `mathBlockRegex` 正常提取，占位符自动消失。
- **块级公式骨架屏占位**：`%%MATHBLOCK{n}%%` 占位符替换回 `<div class="math-block">` 时，内部使用 `<span class="math-block-placeholder">` 骨架屏（shimmer 动画），而非 `escapeHtml(formula)` 暴露 LaTeX 源码。KaTeX 渲染时 `el.innerHTML` 会被整体覆盖，骨架屏自动消失。
- **KaTeX JS/CSS 异步加载骨架屏**：`renderMath()` 首次执行时动态 `import('katex')` 并注入 `<link>` 标签加载 `katex.min.css`，等待 `onload` 后才渲染公式。加载期间公式位置显示骨架屏，不暴露未样式化的 LaTeX 字符。

行内公式（`$...$`）因公式短、闪现不明显，保持 `escapeHtml(formula)` 占位逻辑，不强制使用骨架屏。

#### Scenario: 流式输出中 $$ 未闭合时显示骨架屏

- **WHEN** 流式输出内容为 `"计算公式：$$\\int_0^"`（`$$` 尚未闭合）
- **THEN** `renderMarkdown()` 将 `$$\int_0^` 替换为 `%%MATHBLOCK_UNCLOSED%%` 占位符
- **AND** 最终 HTML 包含 `<div class="math-block" data-pending="true">` 和骨架屏 `<span class="math-block-placeholder">`
- **AND** `renderMath()` 跳过该元素，不调用 KaTeX 渲染

#### Scenario: $$ 闭合后正常渲染

- **WHEN** 流式输出继续，内容变为 `"计算公式：$$\\int_0^1 f(x)dx$$"`（`$$` 已闭合）
- **THEN** `mathBlockRegex` 正常匹配并提取公式，`%%MATHBLOCK_UNCLOSED%%` 占位符消失
- **AND** 公式被 `%%MATHBLOCK0%%` 占位符替换，最终渲染为带骨架屏的 `<div class="math-block" data-formula="...">`
- **AND** `renderMath()` 调用 KaTeX 渲染公式，骨架屏被覆盖

#### Scenario: 块级公式 KaTeX 加载期间显示骨架屏

- **WHEN** 首次渲染块级公式且 KaTeX JS/CSS 尚未加载完成
- **THEN** `<div class="math-block">` 内部显示 `<span class="math-block-placeholder">` 骨架屏（shimmer 动画）
- **AND** 不直接暴露 `\int_0^1 f(x)dx` 等 LaTeX 源码字符

### Requirement: MarkdownRenderer 片段解析与声明式渲染

`components/chat/MarkdownRenderer.vue` SHALL 通过 `parseSegments(html)` 函数将 `renderMarkdown()` 输出的 HTML 拆分为三类片段数组：

- **TextSegment**（`type: 'text'`）：不含代码块的 HTML 片段，通过 `v-html` 渲染
- **CodeSegment**（`type: 'code'`）：从 `<pre><code class="language-xxx">` 提取的代码块，包含 `language` 和解码后的 `code`（HTML 实体已还原）
- **MermaidSegment**（`type: 'mermaid'`）：`language` 为 `mermaid` 的代码块，包含 `source` 原始内容

片段提取使用正则 `/<pre><code(?: class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g` 全局匹配，按代码块位置切片交替生成文本段和代码段。HTML 实体解码 SHALL 覆盖 `&amp;`、`&lt;`、`&gt;`、`&quot;`、`&#39;`、`&#x27;`、`&#x2F;`。

代码块 SHALL 使用声明式 `AsyncCodeBlock`（通过 `defineAsyncComponent(() => import('./CodeBlock.vue'))` 懒加载）渲染，MUST NOT 使用 `createApp(CodeBlock).mount()` 动态挂载方式（已迁移）。Mermaid 块 SHALL 使用声明式 `AsyncMermaidBlock` 懒加载。`AsyncCodeBlock` 和 `AsyncMermaidBlock` SHALL 提供加载中骨架屏 `loadingComponent` 和加载失败 `errorComponent`（含重试按钮）。

**关键约束**：CodeBlock 已从 `createApp` 动态挂载迁移到声明式 `AsyncCodeBlock`（`defineAsyncComponent`），不要回退到 `createApp` 方式。

#### Scenario: 纯文本无代码块时单片段渲染

- **WHEN** `renderMarkdown()` 输出的 HTML 不含 `<pre><code>` 块
- **THEN** `parseSegments()` 返回单个 TextSegment，整段通过 `v-html` 渲染

#### Scenario: 代码块前后有文本时三片段渲染

- **WHEN** HTML 内容为 `"文本A<pre><code class="language-js">code</code></pre>文本B"`
- **THEN** `parseSegments()` 返回三个片段：TextSegment("文本A")、CodeSegment(language="js", code="code")、TextSegment("文本B")
- **AND** 代码片段通过 `<AsyncCodeBlock :code :language>` 声明式渲染

#### Scenario: Mermaid 代码块识别

- **WHEN** HTML 内容含 `<pre><code class="language-mermaid">graph TD\nA-->B</code></pre>`
- **THEN** `parseSegments()` 返回 MermaidSegment（`type: 'mermaid'`，`source: "graph TD\nA-->B"`）
- **AND** 模板通过 `<AsyncMermaidBlock :source>` 渲染（流式输出期间显示占位符）

#### Scenario: CodeBlock 懒加载失败时显示重试

- **WHEN** `AsyncCodeBlock` 加载失败（网络错误）
- **THEN** 显示 `errorComponent`，包含「代码块加载失败」文案和「点击重试」按钮
- **AND** 不影响其他已加载片段的正常渲染

### Requirement: KaTeX 动态加载与懒渲染

`utils/katex.ts` SHALL 将 KaTeX 的 JS 和 CSS 改为动态加载，不在首屏同步引入：

- `loadKatex()` SHALL 使用 `await import('katex')` 动态加载 KaTeX JS，加载后缓存到 `katexCache`，后续调用直接返回缓存实例。
- `injectKatexCss()` SHALL 通过创建 `<link rel="stylesheet">` 标签动态注入 `https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css`，等待 `onload` 后才 resolve，避免无样式闪烁。`<link>` 加载失败或 100ms 超时（jsdom 等环境 `onload` 不触发）也 resolve，不永久挂起。
- `renderMath(element)` SHALL 跳过带 `data-katex-rendered` 属性的元素（避免重复渲染）和带 `data-pending` 属性的元素（流式未闭合 `$$`）。
- 当未渲染公式数量 ≤ `LAZY_RENDER_THRESHOLD`（5）时，全量同步渲染；数量较多时，视口内立即渲染，视口外元素通过 `IntersectionObserver`（`rootMargin: '200px 0px'`）延迟渲染，进入视口预渲染范围后渲染并 `unobserve`。
- `renderMath()` SHALL 返回 cleanup 函数，调用方（`MarkdownRenderer`）在重新渲染或卸载时调用以断开 `IntersectionObserver`。
- `renderSingleFormula()` SHALL 使用 `katex.renderToString(formula, { displayMode, throwOnError: false, errorColor: '#F93920' })` 渲染，块级公式额外添加 `katex-display` class。渲染后标记 `data-katex-rendered="true"`。

#### Scenario: 首次渲染公式时动态加载 KaTeX

- **WHEN** AI 回复包含数学公式且 KaTeX 尚未加载
- **THEN** `renderMath()` 异步 `import('katex')` 加载 JS
- **AND** 动态注入 `katex.min.css` 的 `<link>` 标签
- **AND** CSS `onload` 完成后才调用 `katex.renderToString()` 渲染公式
- **AND** 渲染前公式位置显示骨架屏（块级）或纯文本（行内），不闪烁

#### Scenario: KaTeX 已加载后直接使用缓存

- **WHEN** KaTeX 已加载且 AI 回复包含新的数学公式
- **THEN** `loadKatex()` 直接返回 `katexCache`，不再重复 `import` 和注入 CSS

#### Scenario: 公式数量多时延迟渲染

- **WHEN** 容器内未渲染公式数量 > 5（`LAZY_RENDER_THRESHOLD`）
- **THEN** 视口内（含 200px 预渲染范围）的公式立即渲染
- **AND** 视口外的公式通过 `IntersectionObserver` 观察，进入视口时渲染并 `unobserve`

#### Scenario: 流式未闭合公式被跳过

- **WHEN** `renderMath()` 遇到带 `data-pending="true"` 的 `.math-block` 元素
- **THEN** 跳过该元素，不调用 KaTeX 渲染
- **AND** 不标记 `data-katex-rendered`，等 `$$` 闭合后正常渲染

### Requirement: highlight.js 按需语言注册

`utils/highlight.ts` SHALL 通过 `highlight.js/lib/core` 引入精简版 highlight.js，仅注册以下 12 种常用语言：`javascript`、`typescript`、`python`、`go`、`java`、`bash`、`sql`、`json`、`yaml`、`markdown`、`xml`、`css`。`bash` 同时注册别名为 `shell`，`xml` 同时注册别名为 `html`。未注册语言 SHALL 使用 `hljs.highlightAuto()` 自动检测作为 fallback。模块 SHALL 通过 `export { hljs }` 导出共享实例，CodeBlock 和 MermaidBlock 共用同一实例。

#### Scenario: 已注册语言代码块高亮

- **WHEN** CodeBlock 收到 `language="javascript"` 的代码块
- **THEN** `hljs.getLanguage('javascript')` 返回非空
- **AND** 调用 `hljs.highlight(code, { language: 'javascript' })` 返回带语法高亮的 HTML

#### Scenario: 别名语言高亮

- **WHEN** CodeBlock 收到 `language="shell"` 或 `language="html"` 的代码块
- **THEN** `hljs.getLanguage('shell')` 和 `hljs.getLanguage('html')` 返回非空（分别映射到 bash 和 xml）

#### Scenario: 未注册语言 fallback 自动检测

- **WHEN** CodeBlock 收到 `language="rust"`（未注册）的代码块
- **THEN** `hljs.getLanguage('rust')` 返回 `undefined`
- **AND** 调用 `hljs.highlightAuto(code)` 自动检测语言并渲染，不报错

### Requirement: CodeBlock 组件交互

`components/chat/CodeBlock.vue` SHALL 接受 `code: string` 和 `language?: string` props，提供以下交互能力：

- **语言标签显示**：代码块顶部 header 区域 SHALL 显示 `language || 'text'` 语言标签（`font-mono` 字体）。
- **复制按钮**：header 右侧 SHALL 显示复制按钮，点击后调用 `navigator.clipboard.writeText(code)` 复制代码。
- **复制成功图标切换**：复制成功后按钮图标从「复制」SVG 切换为「对勾」SVG（`text-semi-code-dark-success` 颜色），2 秒后自动恢复。
- **复制状态反馈**：按钮 SHALL 通过 `v-tooltip` 显示「复制代码」/「已复制」提示，按钮文字同步切换为「复制」/「已复制」，MUST NOT 使用原生 `title` 属性。
- **复制事件 emit**：复制成功后 SHALL `emit('copy', code)` 事件，供父组件监听（可用于 Toast 反馈）。
- **IntersectionObserver 懒渲染**：代码块 SHALL 在进入视口（含 200px 预渲染范围）后才执行 `hljs.highlight()`，未进入视口时显示骨架屏占位（`animate-pulse` 灰色块）。
- **语法高亮**：已注册语言使用 `hljs.highlight(code, { language })`，未注册语言使用 `hljs.highlightAuto(code)`，结果通过 `v-html` 渲染到 `<code>` 标签。

#### Scenario: 点击复制按钮复制代码

- **WHEN** 用户点击 CodeBlock 的复制按钮
- **THEN** 调用 `navigator.clipboard.writeText(code)` 复制代码到剪贴板
- **AND** 按钮图标切换为对勾（`text-semi-code-dark-success` 颜色）
- **AND** `v-tooltip` 文案变为「已复制」，按钮文字变为「已复制」
- **AND** 2 秒后图标和文字自动恢复
- **AND** `emit('copy', code)` 事件触发

#### Scenario: 代码块未进入视口时显示骨架屏

- **WHEN** CodeBlock 渲染时 wrapper 元素未进入视口（`rect.top >= window.innerHeight + 200`）
- **THEN** `isVisible` 为 false，`<pre>` 标签不渲染
- **AND** 显示骨架屏占位（3 行 `animate-pulse` 灰色块）
- **AND** 不调用 `hljs.highlight()`

#### Scenario: 代码块进入视口后渲染高亮

- **WHEN** IntersectionObserver 检测到代码块进入视口（含 200px 预渲染范围）
- **THEN** `isVisible` 设为 true，`observer.disconnect()` 断开观察
- **AND** `<pre><code v-html="highlightedCode">` 渲染语法高亮代码

### Requirement: MermaidBlock 组件交互

`components/chat/MermaidBlock.vue` SHALL 接受 `source: string` prop，提供图表/源码双 tab 切换、错误回退、流式占位等能力：

- **双 tab 切换**：header 区域 SHALL 提供「图表」和「代码」两个 tab，默认 `activeTab = 'chart'`。点击 tab 切换 `activeTab` 值，对应面板通过 `v-show` 显示/隐藏。
- **图表渲染**：「图表」tab 激活时，`onMounted` 中调用 `renderMermaidDiagram(source, containerRef)` 渲染 Mermaid 图表到 `<div ref="containerRef">`。渲染期间显示 spinner 加载指示器（`mermaid-spinner` 旋转动画 + 「渲染中…」文案）。
- **错误回退**：渲染失败时 `hasError` 设为 true，「图表」面板显示 `<div class="mermaid-error">`，内部包含「流程图渲染失败」文案和 `<pre class="mermaid-fallback"><code>{{ source }}</code></pre>` 源码回退显示。
- **源码 tab**：「代码」tab 激活时显示 `<pre class="mermaid-code-pre">` 包裹的源码，使用 `hljs.highlight(source, { language: 'yaml' })` 高亮（失败时 fallback 到 `hljs.highlightAuto`）。「代码」tab 激活时显示复制按钮（与 CodeBlock 相同的图标切换逻辑）。
- **流式输出占位**：`MarkdownRenderer` 流式输出期间（`isStreaming = true`）SHALL NOT 渲染 `MermaidBlock`，而是显示占位符 `<div class="mermaid-pending">⏳ Mermaid 图表将在输出完成后渲染…</div>`。
- **内容稳定后渲染**：`MarkdownRenderer` SHALL 在内容稳定 1500ms 后（`contentStableTimer`）才将 `isStreaming` 设为 false，此时 Mermaid 块才渲染 `AsyncMermaidBlock`。这避免流式输出期间 Mermaid 反复重新渲染。

#### Scenario: 流式输出期间显示占位符

- **WHEN** `MarkdownRenderer` 的 `isStreaming` 为 true（内容正在变化）
- **AND** `parseSegments` 返回 MermaidSegment
- **THEN** 模板渲染 `<div class="mermaid-pending">⏳ Mermaid 图表将在输出完成后渲染…</div>`
- **AND** 不加载 `AsyncMermaidBlock` 组件

#### Scenario: 内容稳定 1500ms 后渲染 Mermaid

- **WHEN** `props.content` 变化触发 watch，`scheduleRender()` 执行后启动 `contentStableTimer`
- **AND** 1500ms 内 `props.content` 未再变化
- **THEN** `contentStableTimer` 回调执行，`isStreaming` 设为 false
- **AND** Mermaid 块渲染 `<AsyncMermaidBlock :source>`
- **AND** `AsyncMermaidBlock` 的 `onMounted` 调用 `renderMermaidDiagram` 渲染图表

#### Scenario: Mermaid 渲染失败时回退显示源码

- **WHEN** `renderMermaidDiagram(source, containerRef)` 抛出异常
- **THEN** `hasError` 设为 true，`isRendering` 设为 false
- **AND** 「图表」面板显示 `<div class="mermaid-error">` 含「流程图渲染失败」文案
- **AND** 错误面板内 `<pre class="mermaid-fallback"><code>{{ source }}</code></pre>` 显示原始源码

#### Scenario: 切换到代码 tab 查看源码

- **WHEN** 用户点击「代码」tab
- **THEN** `activeTab` 设为 `'code'`
- **AND** 「代码」面板显示，使用 `hljs.highlight(source, { language: 'yaml' })` 高亮源码
- **AND** header 右侧显示复制按钮（点击复制 `source` 到剪贴板，图标切换逻辑同 CodeBlock）

### Requirement: 图片渲染与 Lightbox 放大

`MarkdownRenderer.vue` SHALL 通过 `renderImages()` 函数为容器内的 `<img>` 标签增强交互能力：

- **安全属性**：`renderMarkdown()` 已自动注入 `referrerpolicy="no-referrer"` 和 `loading="lazy"`。`renderImages()` SHALL 再次设置 `img.referrerPolicy = 'no-referrer'` 确保属性生效。
- **加载中骨架屏**：`<img>` SHALL 通过 CSS 显示 shimmer 动画骨架屏（`background: linear-gradient` + `animation: img-shimmer 1.5s infinite`），`min-height: 180px` 避免高度塌陷。图片 `load` 事件触发后添加 `img-loaded` class，骨架屏消失（`opacity: 1` + `background: none` + `animation: none`）。已 `complete` 且 `naturalWidth > 0` 的图片立即添加 `img-loaded`。
- **加载失败占位**：`error` 事件触发时 SHALL 将 `<img>` 替换为 `<div class="img-error">`，内含图片失败 SVG 图标和「图片加载失败」文案，若 `img.alt` 或 `img.src` 存在则追加 `(altText)` 文本。
- **去重处理**：`renderImages()` SHALL 通过 `img.dataset.imgProcessed = 'true'` 标记已处理的图片，避免重复绑定事件。`error` 处理也通过检查 `parentElement.classList.contains('img-error')` 防止重复替换。
- **点击放大 Lightbox**：点击图片 SHALL 调用 `openLightbox(img.src)`，将 `lightboxSrc` 设为图片 URL。Lightbox 通过 `<Teleport to="body">` 渲染全屏遮罩（`position: fixed; inset: 0`），内部 `<img>` 限制为 `max-width: 92vw; max-height: 92vh; object-fit: contain`。点击遮罩或按 ESC 关闭 Lightbox（`lightboxSrc = ''`）。Lightbox 使用 `<Transition name="fade">` 过渡动画。
- **图片样式**：`<img>` SHALL 设置 `cursor: zoom-in`，`max-width: 100%`，`img-loaded:hover` 时 `opacity: 0.92`。

#### Scenario: 图片加载中显示骨架屏

- **WHEN** `<img>` 标签渲染但图片尚未加载完成
- **THEN** 图片显示 `img-shimmer` 动画骨架屏（渐变背景循环移动）
- **AND** `min-height: 180px` 保证骨架屏高度

#### Scenario: 图片加载完成后骨架屏消失

- **WHEN** 图片 `load` 事件触发
- **THEN** 添加 `img-loaded` class
- **AND** `min-height: 0`、`background: none`、`opacity: 1`、`animation: none`
- **AND** 骨架屏消失，图片正常显示

#### Scenario: 图片加载失败显示错误占位

- **WHEN** 图片 `error` 事件触发
- **THEN** `<img>` 被替换为 `<div class="img-error">`
- **AND** div 内含图片失败 SVG 图标 + 「图片加载失败」文案
- **AND** 若 `img.alt` 或 `img.src` 存在，追加 `(altText)` 文本

#### Scenario: 点击图片打开 Lightbox 放大

- **WHEN** 用户点击容器内的图片
- **THEN** `lightboxSrc` 设为图片 URL
- **AND** `<Teleport to="body">` 渲染全屏 Lightbox 遮罩
- **AND** Lightbox 内 `<img>` 限制为 `max-width: 92vw; max-height: 92vh`
- **AND** 点击遮罩或图片外部关闭 Lightbox

### Requirement: 表格滚动包装

`MarkdownRenderer.vue` SHALL 通过 `renderTables()` 函数为容器内的 `<table>` 标签添加滚动包装：

- 检测容器内所有 `<table>` 元素，若其 `parentElement` 已包含 `table-wrapper` class 则跳过（避免重复包装）。
- 创建 `<div class="table-wrapper">`，插入到 `<table>` 之前，再将 `<table>` 移入 wrapper 内。
- `table-wrapper` SHALL 通过 CSS 设置 `overflow-x: auto` 和 `-webkit-overflow-scrolling: touch`，实现横向滚动（移动端触摸滑动）。

#### Scenario: 宽表格横向滚动

- **WHEN** Markdown 渲染的表格宽度超出容器宽度
- **THEN** 表格外层包裹 `<div class="table-wrapper">`
- **AND** `overflow-x: auto` 允许用户横向滚动查看完整表格
- **AND** 移动端 `-webkit-overflow-scrolling: touch` 提供平滑滚动

#### Scenario: 重复调用不重复包装

- **WHEN** `renderTables()` 被多次调用（如流式输出期间多次渲染）
- **AND** 表格已被 `table-wrapper` 包裹
- **THEN** 跳过该表格，不创建新的 wrapper

### Requirement: MarkdownRenderer 渲染调度与生命周期

`MarkdownRenderer.vue` SHALL 通过 `requestAnimationFrame` 调度渲染，避免高频流式更新阻塞主线程：

- **渲染调度**：`scheduleRender()` SHALL 使用 `requestAnimationFrame` 调度 `doRender()`，若已有 `rafId` 在等待则跳过，合并同一帧内的多次更新。
- **内容去重**：`doRender()` SHALL 比较 `props.content` 与 `lastRenderedContent`，相同则跳过渲染。
- **流式标记**：`doRender()` SHALL 将 `isStreaming` 设为 true，调用 `renderMarkdown()` 和 `parseSegments()` 更新 `segments.value`（`shallowRef` 避免深层响应式追踪）。
- **后处理**：`nextTick` 后 SHALL 依次调用 `renderTables()`、`renderImages()`、`renderMath(containerRef)`。`renderMath()` 返回的 cleanup 函数 SHALL 保存到 `mathCleanup` 变量，重新渲染前调用以断开旧的 `IntersectionObserver`。
- **内容稳定检测**：`watch(props.content)` SHALL 每次变化时启动 `contentStableTimer`（1500ms），定时器回调将 `isStreaming` 设为 false 并重新调用 `renderMath()` 渲染流式期间未渲染的公式。定时器在每次内容变化时重置。
- **immediate 触发**：watch SHALL 使用 `{ immediate: true }` 选项，确保加载历史消息时也触发 `contentStableTimer`（否则 `isStreaming` 永远为 true，Mermaid 占位符永久显示）。
- **卸载清理**：`onUnmounted` SHALL 取消 `rafId`（`cancelAnimationFrame`）、清除 `contentStableTimer`、调用 `mathCleanup()` 断开 `IntersectionObserver`。
- **shallowRef**：`segments` SHALL 使用 `shallowRef` 而非 `ref`，避免对大型 HTML 字符串做深层响应式追踪。

#### Scenario: 流式高频更新合并渲染

- **WHEN** `props.content` 在同一帧内多次变化（如流式 token 快速到达）
- **THEN** `scheduleRender()` 通过 `requestAnimationFrame` 合并为单次 `doRender()` 调用
- **AND** `lastRenderedContent` 去重避免相同内容重复渲染

#### Scenario: 卸载时清理资源

- **WHEN** `MarkdownRenderer` 组件卸载
- **THEN** `cancelAnimationFrame(rafId)` 取消待执行的渲染
- **AND** `clearTimeout(contentStableTimer)` 取消内容稳定检测
- **AND** `mathCleanup()` 断开 `IntersectionObserver`，避免内存泄漏

### Requirement: v-html 安全净化约束

**关键约束**：永远不要将未净化的字符串直接传入 `v-html`，MUST 经过 `renderMarkdown()` 处理（内含 DOMPurify 净化）。

`MarkdownRenderer.vue` 模板中 `v-html="seg.html"` 渲染的 HTML MUST 来自 `renderMarkdown()` 的输出，MUST NOT 直接渲染用户输入或 LLM 原始输出。CodeBlock 的 `v-html="highlightedCode"` 和 MermaidBlock 的 `v-html="highlightedCode"` 渲染的 HTML MUST 来自 `hljs.highlight()` 或 `hljs.highlightAuto()` 的输出（highlight.js 内部已转义 HTML 特殊字符）。

**测试约束**：修改 Markdown 渲染相关代码后 MUST 运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证，确保渲染管线不回归。

#### Scenario: 用户输入经过 renderMarkdown 净化

- **WHEN** LLM 输出包含 `<script>alert(1)</script>` 或 `<img onerror="...">` 等 XSS payload
- **THEN** `renderMarkdown()` 内部 `DOMPurify.sanitize()` 移除危险标签和属性
- **AND** `v-html` 渲染的 HTML 不含可执行脚本

#### Scenario: highlight.js 输出安全

- **WHEN** 代码内容包含 `<script>` 字符串
- **THEN** `hljs.highlight()` 内部转义 HTML 特殊字符（`<` → `&lt;`）
- **AND** `v-html="highlightedCode"` 渲染后 `<script>` 显示为文本，不执行
