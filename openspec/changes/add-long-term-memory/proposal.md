## Why

当前项目仅以「当前会话的 messages 表」作为记忆（见 AGENTS.md 记忆系统章节），存在跨会话失忆问题：用户新开会话后，AI 无法回忆过去会话中讨论过的内容。`openspec/agent-future-roadmap.md` 已将「长期记忆系统」列为远期规划，现在正式启动：引入向量库（embedding + 检索），让 LLM 能跨会话回忆历史内容。

## What Changes

- 新增 PostgreSQL pgvector 扩展支持，新建向量存储表存储消息 embedding
- 新增 embedding 服务调用（`BAAI/bge-m3`），把文本转向量存入向量库
- 新增重排序服务调用（`BAAI/bge-reranker-v2-m3`），对 embedding 召回结果精排，提升检索准确率
- 新增「重要度筛选入库」机制：会话结束时由 LLM 自主判断哪些内容值得长期记住，只对重要内容做 embedding 入库（避免全量入库的存储成本）
- 新增 `recall-memory` Agent 工具：LLM 自主决定何时检索长期记忆、检索什么（Agentic RAG 路径 A，非 Workflow 预检索注入）
- 在 `server/tools/` 新增工具文件，在 `chat.post.ts` 注册
- 修改 `server/db/schema.ts` 新增向量表，运行 `pnpm db:push` 同步

## Capabilities

### New Capabilities

- `long-term-memory`: 长期记忆系统——会话结束时按重要度筛选入库（embedding + 向量存储），LLM 通过 `recall-memory` 工具自主检索跨会话历史，检索结果经重排序精排后返回

### Modified Capabilities

无。本变更新增独立能力，不修改现有 chat-input / ocr-tool / ip-location-tool / mcp-weather-tool / lazy-rendering 的 spec 级需求。

## Impact

| 层级 | 影响 |
| --- | --- |
| 数据库 | 启用 pgvector 扩展；新增向量存储表（含 embedding 列、消息引用、会话引用） |
| 后端 | 新增 `server/tools/embed-memory.ts`（入库工具）、`server/tools/recall-memory.ts`（检索工具）；新增 embedding/rerank 服务调用；修改 `chat.post.ts` 注册检索工具 |
| Agent 架构 | 新增 `recall-memory` 工具走 Agent 路径（LLM 自主调用）；重要度筛选入库由 LLM 在会话生命周期事件触发 |
| 依赖 | 调用硅基流动 embedding API（复用 `OPENAI_API_KEY`）；PostgreSQL 需启用 pgvector 扩展 |
| 文档 | 需同步更新 `docs/db-schema.md`、`docs/API.md`（如有新接口） |
