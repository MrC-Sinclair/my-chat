---
paths:
  - 'server/db/**'
  - 'drizzle.config.ts'
---

<!-- 这个目录下的是 Claude Code 的"路径限定规则"（path-scoped rule）。
     它不会在每次对话都加载，只有当 Claude 读写上面 paths 列出的文件时才会加载。
     这样做的好处：节省上下文空间，让规则更精准地生效。
     更多说明：https://docs.anthropic.com/en/docs/claude-code/memory -->

- **IMPORTANT**: 修改 `server/db/schema.ts` 后必须运行 `pnpm db:push` 同步到数据库
- **IMPORTANT**: 测试数据库和生产数据库隔离，E2E 测试不会污染开发数据
- 数据库开发端口是 **5434**（非默认 5432），测试端口是 **5433**，避免与本地 PostgreSQL 冲突
