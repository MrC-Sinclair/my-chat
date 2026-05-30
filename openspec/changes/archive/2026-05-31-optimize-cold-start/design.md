## Context

当前应用冷启动时首屏 JS 体积约 1.8MB+，主要来自以下重型库的同步引入：

- **highlight.js**：`import hljs from 'highlight.js'` 引入了全部 180+ 语言包（~300KB），但实际只用到 10 种左右
- **mermaid**：~1.2MB，仅在 AI 回复包含 mermaid 代码块时才需要
- **katex**：~300KB，仅在 AI 回复包含数学公式时才需要
- **DOMPurify + marked**：~50KB，体积可控但首屏空消息时不需要

此外，[ai-chat.vue](../../pages/ai-chat.vue) 中所有子组件（MarkdownRenderer、CodeBlock、MermaidBlock、ThinkingProcess、ToolInvocation、SessionSidebar）均为静态 import，首屏同步加载。

当前项目使用 SSR（Nuxt 默认），服务端渲染时需要执行 `renderMarkdown()`，但 `katex.renderToString()` 依赖浏览器 DOM，SSR 环境不可用。

## Goals / Non-Goals

**Goals:**

- 首屏 JS 体积减少 60-70%（从 ~1.8MB 降至 ~400KB）
- 首屏空消息状态下不加载任何 Markdown 渲染相关依赖
- 消息出现后按需加载渲染组件，不影响流式输出体验
- highlight.js 仅包含常用语言，体积从 ~300KB 降至 ~50KB
- SSR 水合不匹配风险为零

**Non-Goals:**

- 不改变 SSR 渲染策略（不切换为 CSR 或 hybrid rendering）
- 不优化服务端启动时间（数据库连接、Nitro 冷启动等）
- 不优化 Vite 中间件（fix-windows-path-urls）
- 不引入 Service Worker 或 PWA 缓存策略
- 不优化图片加载（已有 lazy loading）

## Decisions

### Decision 1: 使用 `defineAsyncComponent()` 而非 `v-if` + 动态 import

**选择**：`defineAsyncComponent()`

**理由**：
- `defineAsyncComponent` 是 Vue 官方的异步组件方案，与 Nuxt 的代码分割机制天然集成
- 自动处理 loading 状态和错误边界，无需手动管理
- 组件加载后自动缓存，不会重复请求
- `v-if` + 动态 import 需要手动管理 `shallowRef`、loading/error 状态，代码更复杂

**替代方案**：
- `v-if` + `shallowRef` + 动态 import：更灵活但代码量大，且需要手动处理加载状态
- Nuxt 的 `LazyXxx` 自动导入：Nuxt 会自动为 `components/` 下的组件生成 `Lazy` 前缀版本，但只适用于简单场景，无法精细控制加载时机

### Decision 2: MarkdownRenderer 在消息列表中按需渲染而非整体懒加载

**选择**：MarkdownRenderer 保持同步 import，但其内部重型依赖（CodeBlock、MermaidBlock、katex）改为懒加载

**理由**：
- MarkdownRenderer 是每条 AI 消息的核心渲染器，如果整体懒加载会导致流式输出时出现闪烁
- `renderMarkdown()` 在 `doRender()` 中同步调用，如果 MarkdownRenderer 异步加载，首条消息渲染会延迟
- 更好的策略是让 MarkdownRenderer 同步加载（体积小，只有 marked + DOMPurify），但让其内部的 CodeBlock、MermaidBlock 通过 `defineAsyncComponent` 懒加载

### Decision 3: highlight.js 按需引入语言

**选择**：创建 `utils/highlight.ts` 统一管理语言注册

**理由**：
- 当前 CodeBlock.vue 和 MermaidBlock.vue 都 `import hljs from 'highlight.js'`，各自引入全量包
- 统一到一个入口文件，只注册常用语言（js/ts/python/go/java/bash/sql/json/yaml/markdown/xml/css），体积从 ~300KB 降至 ~50KB
- 未来需要新语言时只需在 `utils/highlight.ts` 中添加一行

### Decision 4: katex.ts 改为动态 import

**选择**：`renderMath()` 内部使用 `const katex = await import('katex')` 动态加载

**理由**：
- `renderMath()` 已经在 `onMounted` / `nextTick` 中调用，改为 async 无需改变调用方式
- KaTeX 的 CSS（`katex/dist/katex.min.css`）从 `@import` 改为在 `renderMath()` 中动态注入 `<link>` 标签
- 这样首屏不会加载 KaTeX 的 JS 和 CSS（~300KB + ~30KB CSS）

### Decision 5: SessionSidebar 使用 Nuxt 的 `LazySessionSidebar` 自动导入

**选择**：使用 Nuxt 自动生成的 `LazySessionSidebar`

**理由**：
- SessionSidebar 在桌面端默认隐藏（`v-show="showSidebar"`），手机端覆盖式弹出
- Nuxt 自动为 `components/` 下的组件生成 `Lazy` 前缀版本，无需手动 `defineAsyncComponent`
- 简单场景直接用 Nuxt 内置能力

## Risks / Trade-offs

- **[首条消息渲染延迟]** → MarkdownRenderer 内的 CodeBlock/MermaidBlock 懒加载后，首次出现代码块/图表时会有短暂 loading。缓解：`defineAsyncComponent` 的 `loadingComponent` 选项显示骨架屏
- **[SSR 水合]** → 异步组件在 SSR 时渲染为注释节点，客户端水合时才加载。缓解：MarkdownRenderer 保持同步，只有非首屏必需组件使用异步；SSR 时 `renderMath()` 不会执行（依赖 DOM）
- **[highlight.js 语言覆盖]** → 按需引入意味着不常用的语言（如 Erlang、Haskell）没有语法高亮。缓解：保留 `hljs.highlightAuto()` 作为 fallback，未注册语言仍可自动检测
- **[KaTeX CSS 闪烁]** → 动态注入 CSS 可能在公式渲染后才加载完成，导致公式短暂无样式。缓解：在 `renderMath()` 中先注入 CSS `<link>` 标签，等 `onload` 后再执行渲染
