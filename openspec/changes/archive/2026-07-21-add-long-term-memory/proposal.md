## Why

当前项目仅以「当前会话的 messages 表」作为记忆（见 AGENTS.md 记忆系统章节），存在跨会话失忆问题：用户新开会话后，AI 无法回忆过去会话中讨论过的内容。`openspec/agent-future-roadmap.md` 已将「长期记忆系统」列为远期规划，现在正式启动：引入向量库（embedding + 检索），让 LLM 能跨会话回忆历史内容。

## What Changes

- 调整 `docker-compose.yml`，使用 `pgvector/pgvector:pg18` 镜像以支持向量扩展（与当前 `postgres:18-alpine` 同为 PG 18，数据文件格式预期兼容；但 Alpine→Debian 基础镜像可能导致 locale/collation 差异，需先在测试库 5433 验证 + `pnpm test:api` 通过后再切开发库，必要时 `REINDEX DATABASE`）
- 新增 PostgreSQL pgvector 扩展支持，在 `server/db/index.ts` 服务启动时幂等启用扩展；在 `server/db/schema.ts` 中使用 Drizzle ORM 原生 `vector({ dimensions: 1024 })` 类型新建 `memory_vectors` 向量存储表（含 `archived_at` 字段和 HNSW 索引，使用 pgvector 默认参数 m=16/ef_construction=64）
- 新增 embedding 服务调用（默认 `BAAI/bge-m3`，1024 维），把文本转向量存入向量库；超长文本交由 API 自行截断
- 新增重排序服务调用（默认 `BAAI/bge-reranker-v2-m3`），对 embedding 召回结果精排，提升检索准确率；调用时传 `return_documents: true`
- 新增「重要度筛选入库」机制：会话切换时由 LLM 自主判断哪些内容值得长期记住（复用项目现有 `createReasoningProvider()` + AI SDK v5 `generateText()` 非流式调用，通过 customFetch 层注入 `enable_thinking: false` 关闭思考，保持架构一致），只对重要内容做 embedding 入库（避免全量入库的存储成本）
- 新增 `recall-memory` Agent 工具：LLM 自主决定何时检索长期记忆、检索什么（Agentic RAG 路径 A，非 Workflow 预检索注入）；返回结果包含 `score` 字段
- 在 `server/tools/` 新增 `recall-memory.ts`（Agent 检索工具），在 `server/utils/` 新增 `memory-archive.ts`（Workflow 归档逻辑，含进程内并发锁）和 `embedding.ts`+`reranker.ts`（服务封装），在 `chat.post.ts` 注册检索工具
- 修改 `chat.post.ts`：从请求 body 读取 `lastSessionId`，在 `onFinish` 中 fire-and-forget 触发服务端归档兜底（保持无状态，不引入全局会话缓存），覆盖浏览器关闭/刷新场景
- 修改 `nuxt.config.ts` 与 `.env.example`，将 embedding/reranker/重要度模型纳入 runtimeConfig（不再纳入 HNSW 参数，使用 pgvector 默认值）
- 修改 `server/db/schema.ts` 新增向量表，运行 `pnpm db:push` 同步

## Capabilities

### New Capabilities

- `long-term-memory`: 长期记忆系统——会话结束时按重要度筛选入库（embedding + 向量存储），LLM 通过 `recall-memory` 工具自主检索跨会话历史，检索结果经重排序精排后返回（含 score 分数）

### Modified Capabilities

无。本变更新增独立能力，不修改现有 chat-input / ocr-tool / ip-location-tool / mcp-weather-tool / lazy-rendering 的 spec 级需求。

## Impact

| 层级 | 影响 |
| --- | --- |
| 基础设施 | `docker-compose.yml` 的 PostgreSQL 镜像切换为 `pgvector/pgvector:pg18`（与当前 `postgres:18-alpine` 同为 PG 18，数据文件格式预期兼容；但 Alpine→Debian 基础镜像可能导致 locale/collation 差异，需先在测试库 5433 验证 + `pnpm test:api` 通过后再切开发库，必要时 `REINDEX DATABASE`）；执行 `docker compose up -d` 重建容器即可 |
| 数据库 | 在 `server/db/index.ts` 启动时幂等启用 pgvector 扩展；新增 `memory_vectors` 向量存储表（含 embedding 列、消息引用、会话引用、created_at 从 messages 复制、archived_at defaultNow、HNSW 索引使用 pgvector 默认参数）；使用 Drizzle ORM 原生 `vector` 类型，无需 customType |
| 后端 | 新增 `server/utils/embedding.ts`（embedding 服务）、`server/utils/reranker.ts`（重排序服务）、`server/utils/memory-archive.ts`（归档 Workflow，复用 `createReasoningProvider` + `generateText`，含进程内并发锁）、`server/tools/recall-memory.ts`（检索 Agent 工具，返回含 score）；修改 `chat.post.ts` 注册检索工具、注入 system prompt、读取 lastSessionId 并在 `onFinish` 中 fire-and-forget 归档兜底 |
| API | 新增 `POST /api/sessions/:id/archive-memory`，路由内需自行校验 UUID 格式，使用进程内 Map 做并发锁 |
| Agent 架构 | 新增 `recall-memory` 工具走 Agent 路径（LLM 自主调用）；重要度筛选入库走 Workflow 路径（会话切换时触发，代码预编排） |
| 配置 | `nuxt.config.ts` runtimeConfig 新增 `embeddingModel`、`rerankerModel`、`memoryImportanceModel`；`.env.example` 同步新增可选变量（不再纳入 HNSW 参数，使用 pgvector 默认值） |
| 依赖 | 调用硅基流动 embedding/reranker API（base URL 从 runtimeConfig 读取，默认 `https://api.siliconflow.cn/v1`，复用 `OPENAI_API_KEY`，兼容 OpenAI 格式）；PostgreSQL 需启用 pgvector 扩展；使用 Drizzle ORM 原生 `vector` 类型（v0.36+ 已支持） |
| 文档 | 需同步更新 `docs/db-schema.md`（新增表含 archived_at）、`docs/API.md`（新增接口） |
