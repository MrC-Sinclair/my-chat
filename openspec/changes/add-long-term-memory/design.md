## Context

项目当前记忆系统（见 AGENTS.md「记忆系统」章节）仅以当前会话的 `messages` 表作为记忆，`streamText` 循环内的工具调用结果作为短期上下文。存在跨会话失忆问题：用户新开会话后，AI 无法回忆过去会话讨论过的内容。`openspec/agent-future-roadmap.md` 已将「长期记忆系统」列为远期规划，本设计正式启动该能力。

技术栈：Nuxt 3 + Vercel AI SDK + PostgreSQL（Drizzle ORM）。现有 DB schema 仅含 `sessions` / `messages` / `feedbacks` 三表，无向量存储能力。硅基流动提供 `BAAI/bge-m3`（embedding）和 `BAAI/bge-reranker-v2-m3`（重排序）免费模型，可复用 `OPENAI_API_KEY`。

## Goals / Non-Goals

**Goals:**

- 实现跨会话长期记忆：LLM 能回忆用户过去任意会话中的重要内容
- 走 Agentic RAG 路径 A：`recall-memory` 作为 Agent 工具，由 LLM 自主决定何时检索、检索什么（符合 AGENTS.md「LLM 自主决策 = Agent」核心判定）
- 按重要度筛选入库：会话结束时由 LLM 判断哪些内容值得长期记住，避免全量入库的存储成本
- 检索结果经重排序精排：embedding 召回 → reranker 精排，提升准确率

**Non-Goals:**

- 不做用户手动收藏/管理记忆的 UI（本期纯后端能力，前端不新增管理界面）
- 不做记忆的更新/删除接口（记忆一旦入库不可变，后续版本再考虑）
- 不做用户隔离（当前项目无用户系统，所有会话共享同一记忆库）
- 不做实时入库（明确选「会话结束批量入库」，非每条消息实时）
- 不做路径 B（Workflow 预检索注入）——违反 Agent 架构原则

## Decisions

### 决策 1：向量存储选 pgvector（复用 PostgreSQL）

**选择**：PostgreSQL + pgvector 扩展

**理由**：项目已用 PostgreSQL（Drizzle ORM），复用现有 DB 不引入新依赖。单机 PG + pgvector 完全够用，记忆数据量级（万级消息）远未到需要独立向量库（Qdrant/Milvus）的规模。

**替代方案**：独立向量库（Qdrant/Milvus/Chroma）——过度设计，新增运维复杂度，收益不抵成本。

### 决策 2：Embedding 模型选 `BAAI/bge-m3`

**选择**：`BAAI/bge-m3`（1024 维，8K 上下文，多语言，支持密集/多向量/稀疏检索）

**理由**：项目是中文为主但可能涉及英文内容（代码、文档）；8K 上下文比 `bge-large-zh-v1.5` 的 512 token 实用得多（单条长消息不会被截断）；多功能检索能力为后续优化留空间。

**替代方案**：`bge-large-zh-v1.5`（中文专用，精度略高但 512 token 太短，长消息需分块，复杂度上升）。

### 决策 3：引入重排序 `BAAI/bge-reranker-v2-m3`

**选择**：embedding 召回 top-20 → `bge-reranker-v2-m3` 精排 → 取 top-5

**理由**：RAG 标准配方（双阶段检索）。embedding 召回快但精度一般，reranker（568M，轻量）对 query-document 对做交叉编码精排，显著提升 top-K 准确率。两阶段延迟可控（embedding 检索 < 50ms，rerank < 200ms）。

**替代方案**：仅 embedding 检索——top-K 噪声大，LLM 可能被无关记忆误导。

### 决策 4：Agentic RAG 路径 A（工具 LLM 自主调用）

**选择**：`recall-memory` 作为 Agent 工具，在 `chat.post.ts` 注册，LLM 自主决定是否调用

**理由**：AGENTS.md 核心判定「LLM 自主决策 = Agent」。工具调用与否、何时调用应由 LLM 决定。用户问"1+1"时 LLM 不会调用检索，用户问"我上周问过 SSRF 怎么做"时 LLM 才调用——避免无关污染。

**替代方案**：路径 B（Workflow 预检索注入，每次请求先检索再注入 prompt）——违反 Agent 原则，无关问题也强制检索，浪费 token、污染上下文。AGENTS.md 明确「确需预检索的场景须在设计文档说明理由」，本场景无此必要。

### 决策 5：重要度筛选入库（会话结束时 LLM 判断）

**选择**：会话结束时，用一次轻量 LLM 调用判断会话内哪些消息值得长期记住，只对重要消息做 embedding 入库

**理由**：用户明确选择此策略。避免全量入库的存储成本；LLM 判断重要度比规则启发式更智能；符合 Agent 架构（LLM 决策）。

**替代方案**：全量入库（成本高、噪声大）、用户手动收藏（需用户操作、体验差）、每条消息实时判断（频繁 LLM 调用、成本高）。

### 决策 6：「会话结束」触发机制——会话切换时异步入库

**选择**：新增后端 API `POST /api/sessions/:id/archive-memory`，前端在用户切换会话或新建会话时，对「上一个会话」调用该接口。接口异步执行重要度判断 + embedding 入库，不阻塞对话。

**理由**：当前项目无显式「会话结束」事件，用户切换会话是自然的「上一个会话告一段落」信号。重要度筛选入库本质是消息持久化操作，按 AGENTS.md「消息持久化走 Workflow」原则，用代码编排（非 LLM 工具）合理。

**替代方案**：显式「结束会话」按钮（需新增前端 UI，增加用户操作负担）、每条消息后判断（不符合用户选择的「会话结束」时机）、超时触发（不可靠）。

**参数校验与错误处理**：
- 路径参数 `id`：校验非空、为字符串，不存在返回 404
- 重复归档守卫：检查该会话是否已归档（`memory_vectors` 表有该会话记录则跳过），防止重复入库
- LLM 重要度判断失败：记录错误日志，不入库（不抛异常，不影响对话）
- Embedding API 失败：记录错误日志，跳过该条消息，继续处理其他消息

### 决策 7：入库粒度——消息级

**选择**：以单条消息为粒度做 embedding 入库

**理由**：简单、可追溯（检索结果能定位到具体消息 + 来源会话）、符合现有 `messages` 表结构。会话级粒度太粗（一个会话可能跨多主题），段落级需额外分块逻辑（复杂）。

## Risks / Trade-offs

| 风险 | 缓解 |
| --- | --- |
| 重要度判断 LLM 调用增加成本和延迟 | 用轻量模型（如 Qwen3.5-4B 关闭思考）；异步执行不阻塞对话；重复归档守卫避免重复调用 |
| pgvector 检索性能在数据量增大后下降 | 当前数据量级（万级）远未达瓶颈；后续可加 ivfflat 索引优化 |
| bge-m3 单次 embedding 上限 8K，超长消息需处理 | 实测单条聊天消息极少超 8K；超长时截断并记录日志 |
| 记忆无用户隔离，多用户场景下隐私问题 | 当前项目无用户系统，属可接受现状；后续引入用户系统时再隔离 |
| 重排序 API 失败导致检索降级 | 重排序失败时降级为仅 embedding 检索结果（top-5），不中断流程 |
| 会话切换时归档未完成用户又切回 | 归档幂等（重复归档守卫）；未完成时该会话内容暂未入库，不影响正确性 |

## Migration Plan

1. **DB 迁移**：在 PostgreSQL 启用 pgvector 扩展（`CREATE EXTENSION vector`）；修改 `server/db/schema.ts` 新增 `memory_vectors` 表；运行 `pnpm db:push`
2. **后端工具**：新增 `server/tools/embed-memory.ts`（embedding 服务）、`server/tools/recall-memory.ts`（检索工具）、`server/utils/memory-archive.ts`（归档逻辑）
3. **注册工具**：在 `chat.post.ts` 的 `toolsConfig` 注册 `recallMemoryTool`（仅对支持工具调用的模型启用）
4. **归档 API**：新增 `server/api/sessions/[id]/archive-memory.post.ts`
5. **前端触发**：在 `useChatSession` 的会话切换逻辑中，对上一个会话调用归档 API（异步、静默失败）
6. **回滚策略**：若发现问题，移除 `recall-memory` 工具注册即可禁用检索（向量表数据保留不影响）；归档 API 移除后不影响对话主流程

## Open Questions

- `[不确定]` 重要度判断的 LLM prompt 设计需在实现时细化（判断标准：事实性内容 vs 闲聊、用户偏好 vs 一次性问题）
- `[不确定]` 是否需要在前端展示「已归档记忆」状态提示（如会话列表标记），本期 Non-Goals 但值得评估
- `[不确定]` 记忆检索的 top-K / top-N 参数需实测调优（当前预估召回 20、精排取 5）
- `[不确定]` 硅基流动 embedding API 的速率限制需实测确认（影响批量归档速度）
