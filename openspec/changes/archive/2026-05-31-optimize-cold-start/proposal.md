## Why

应用冷启动时首屏 JS 体积约 1.8MB+，其中 highlight.js 全量引入（~300KB）、mermaid（~1.2MB）、KaTeX（~300KB）等重型库在首屏同步加载，但首屏空消息时完全不需要这些渲染能力，导致用户等待时间过长。

## What Changes

- highlight.js 从全量引入改为按需引入常用语言（js/ts/python/go/java/bash/sql/json/yaml/markdown），体积从 ~300KB 降至 ~50KB
- MermaidBlock、CodeBlock、MarkdownRenderer 等非首屏必需组件改为 `defineAsyncComponent()` 懒加载
- ThinkingProcess、ToolInvocation 等条件渲染组件改为懒加载
- SessionSidebar 改为懒加载（桌面端默认隐藏，手机端覆盖式弹出）
- katex.ts 的 `renderMath()` 改为动态 `import()`
- KaTeX CSS 从同步 `@import` 改为异步加载

## Capabilities

### New Capabilities

- `lazy-rendering`: 组件懒加载与重型依赖按需引入策略，覆盖 Markdown 渲染管线、代码高亮、Mermaid 图表、KaTeX 公式等模块的延迟加载规范

### Modified Capabilities

## Impact

| 影响层级 | 影响范围 |
|---------|---------|
| 前端组件 | ai-chat.vue、MarkdownRenderer.vue、CodeBlock.vue、MermaidBlock.vue、ThinkingProcess.vue、ToolInvocation.vue、SessionSidebar.vue |
| 前端工具函数 | utils/katex.ts、utils/markdown.ts |
| 构建产物 | 首屏 JS 体积预计减少 60-70%（~1.2MB → ~400KB） |
| 用户体验 | 首屏加载时间显著缩短，非首屏内容按需加载 |
