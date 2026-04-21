---
paths:
  - 'utils/markdown.ts'
  - 'utils/katex.ts'
  - 'components/chat/MarkdownRenderer.vue'
  - 'components/chat/CodeBlock.vue'
---

<!-- 这个目录下的是 Claude Code 的"路径限定规则"（path-scoped rule）。
     它不会在每次对话都加载，只有当 Claude 读写上面 paths 列出的文件时才会加载。
     这样做的好处：节省上下文空间，让规则更精准地生效。
     更多说明：https://docs.anthropic.com/en/docs/claude-code/memory -->

- **CRITICAL**: 永远不要将未净化的字符串直接传入 `v-html`，必须经过 `renderMarkdown()` 处理（内含 DOMPurify 净化）
- **CRITICAL**: DOMPurify 白名单必须包含 MathML（`math`, `mrow`, `mi`, `mfrac` 等）和 SVG（`svg`, `path`, `line` 等）标签，否则 KaTeX 公式会被过滤掉
- **YOU MUST**: 修改 Markdown 渲染相关代码后，运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证
- `MarkdownRenderer.vue` 中代码块通过 `createApp(CodeBlock).mount()` 动态挂载，不是声明式组件。修改时注意 Vue 实例生命周期
