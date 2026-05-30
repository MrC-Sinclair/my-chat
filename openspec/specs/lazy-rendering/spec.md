## ADDED Requirements

### Requirement: highlight.js 按需引入语言

系统 SHALL 通过统一的 `utils/highlight.ts` 入口文件引入 highlight.js，仅注册以下常用语言：javascript、typescript、python、go、java、bash、sql、json、yaml、markdown、xml、css。未注册的语言 SHALL 使用 `hljs.highlightAuto()` 自动检测作为 fallback。

#### Scenario: 常用语言代码块高亮

- **WHEN** AI 回复包含已注册语言（如 javascript）的代码块
- **THEN** 系统使用对应语言的语法高亮规则渲染代码

#### Scenario: 非常用语言代码块高亮

- **WHEN** AI 回复包含未注册语言（如 rust）的代码块
- **THEN** 系统使用 `hljs.highlightAuto()` 自动检测并渲染，不报错

### Requirement: 非首屏必需组件懒加载

系统 SHALL 对以下组件使用懒加载策略，首屏不加载其 JS 和 CSS：

- CodeBlock：通过 `defineAsyncComponent()` 懒加载
- MermaidBlock：通过 `defineAsyncComponent()` 懒加载
- ThinkingProcess：通过 `defineAsyncComponent()` 懒加载
- ToolInvocation：通过 `defineAsyncComponent()` 懒加载
- SessionSidebar：使用 Nuxt 的 `LazySessionSidebar` 自动导入

MarkdownRenderer SHALL 保持同步加载，但其内部的 CodeBlock 和 MermaidBlock SHALL 懒加载。

#### Scenario: 首屏空消息时不加载渲染组件

- **WHEN** 用户首次打开页面且消息列表为空
- **THEN** 系统不加载 CodeBlock、MermaidBlock、ThinkingProcess、ToolInvocation 的 JS 和 CSS
- **AND** 仅加载 ChatInput、布局框架和基础样式

#### Scenario: AI 回复包含代码块时按需加载 CodeBlock

- **WHEN** AI 回复包含代码块且 CodeBlock 尚未加载
- **THEN** 系统异步加载 CodeBlock 组件
- **AND** 加载期间显示代码块骨架屏占位
- **AND** 加载完成后渲染语法高亮代码

#### Scenario: AI 回复包含 Mermaid 图表时按需加载 MermaidBlock

- **WHEN** AI 回复包含 mermaid 代码块且 MermaidBlock 尚未加载
- **THEN** 系统异步加载 MermaidBlock 组件
- **AND** 加载完成后渲染 Mermaid 图表

#### Scenario: AI 回复包含思考过程时按需加载 ThinkingProcess

- **WHEN** AI 回复包含思考内容且 ThinkingProcess 尚未加载
- **THEN** 系统异步加载 ThinkingProcess 组件
- **AND** 加载完成后渲染思考过程折叠面板

#### Scenario: AI 调用工具时按需加载 ToolInvocation

- **WHEN** AI 回复包含工具调用结果且 ToolInvocation 尚未加载
- **THEN** 系统异步加载 ToolInvocation 组件
- **AND** 加载完成后渲染工具调用结果

#### Scenario: 用户展开侧边栏时按需加载 SessionSidebar

- **WHEN** 用户点击侧边栏切换按钮且 SessionSidebar 尚未加载
- **THEN** 系统异步加载 SessionSidebar 组件
- **AND** 加载完成后渲染会话列表

### Requirement: KaTeX 动态加载

系统 SHALL 将 KaTeX 的 JS 和 CSS 改为动态加载，不在首屏同步引入。

- `utils/katex.ts` 的 `renderMath()` SHALL 使用 `await import('katex')` 动态加载 KaTeX
- KaTeX CSS（`katex/dist/katex.min.css`）SHALL 在 `renderMath()` 首次执行时动态注入 `<link>` 标签
- 动态注入的 CSS SHALL 等待 `onload` 后再执行 KaTeX 渲染，避免无样式闪烁

#### Scenario: 首次渲染数学公式时动态加载 KaTeX

- **WHEN** AI 回复包含数学公式且 KaTeX 尚未加载
- **THEN** 系统异步加载 KaTeX JS 和 CSS
- **AND** CSS 加载完成后渲染数学公式
- **AND** 渲染前公式以纯文本形式显示（不闪烁）

#### Scenario: KaTeX 已加载后渲染公式

- **WHEN** KaTeX 已加载且 AI 回复包含新的数学公式
- **THEN** 系统直接使用已缓存的 KaTeX 实例渲染，不再重复加载

### Requirement: 懒加载组件加载状态

系统 SHALL 为 `defineAsyncComponent()` 包裹的组件提供加载状态指示，避免内容区域空白。

- CodeBlock 加载期间 SHALL 显示代码块骨架屏（灰色背景 + 闪烁动画）
- MermaidBlock 加载期间 SHALL 显示图表骨架屏
- ThinkingProcess 和 ToolInvocation 加载期间 SHALL 显示最小化占位（不阻塞消息流）

#### Scenario: CodeBlock 加载中显示骨架屏

- **WHEN** CodeBlock 正在异步加载
- **THEN** 代码块位置显示灰色骨架屏占位
- **AND** 骨架屏高度与实际代码块接近（约 80px）

#### Scenario: 组件加载失败

- **WHEN** 异步组件加载失败（网络错误等）
- **THEN** 系统显示错误提示"组件加载失败，请刷新页面"
- **AND** 不影响其他已加载组件的正常运行
