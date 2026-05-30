## 1. highlight.js 按需引入

- [x] 1.1 创建 `utils/highlight.ts`，引入 highlight.js 核心并注册常用语言（js/ts/python/go/java/bash/sql/json/yaml/markdown/xml/css），导出 `hljs` 实例
- [x] 1.2 修改 `components/chat/CodeBlock.vue`，将 `import hljs from 'highlight.js'` 替换为 `import { hljs } from '~/utils/highlight'`
- [x] 1.3 修改 `components/chat/MermaidBlock.vue`，将 `import hljs from 'highlight.js'` 替换为 `import { hljs } from '~/utils/highlight'`
- [x] 1.4 运行 `pnpm lint` 和 `pnpm typecheck` 验证无错误

## 2. KaTeX 动态加载

- [x] 2.1 修改 `utils/katex.ts`，将 `import katex from 'katex'` 改为 `renderMath()` 内部 `const katex = await import('katex')`，函数签名改为 `async`
- [x] 2.2 在 `renderMath()` 中添加 KaTeX CSS 动态注入逻辑：首次执行时创建 `<link>` 标签注入 `katex/dist/katex.min.css`，等待 `onload` 后再渲染
- [x] 2.3 修改 `components/chat/MarkdownRenderer.vue`，移除 `<style>` 中的 `@import 'katex/dist/katex.min.css'`
- [x] 2.4 运行 `pnpm lint` 和 `pnpm typecheck` 验证无错误

## 3. 组件懒加载

- [x] 3.1 修改 `components/chat/MarkdownRenderer.vue`，将 CodeBlock 和 MermaidBlock 改为 `defineAsyncComponent()` 懒加载，添加 loadingComponent 骨架屏
- [x] 3.2 修改 `pages/ai-chat.vue`，将 ThinkingProcess 改为 `defineAsyncComponent()` 懒加载
- [x] 3.3 修改 `pages/ai-chat.vue`，将 ToolInvocation 改为 `defineAsyncComponent()` 懒加载
- [x] 3.4 修改 `pages/ai-chat.vue`，将 SessionSidebar 改为 `defineAsyncComponent()` 懒加载
- [x] 3.5 运行 `pnpm lint` 和 `pnpm typecheck` 验证无错误

## 4. 验证与测试

- [x] 4.1 运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证 Markdown 渲染无回归
- [x] 4.2 运行 `pnpm test:unit` 验证全部单元测试通过（104/104）
- [x] 4.3 启动开发服务器 `pnpm dev`，验证首屏加载正常、消息发送和流式输出正常、代码块高亮正常、数学公式渲染正常、Mermaid 图表渲染正常
- [x] 4.4 运行 `pnpm build` 验证生产构建无错误
