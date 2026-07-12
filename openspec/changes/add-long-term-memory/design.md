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

### 决策 1：向量存储选 pgvector（复用 PostgreSQL）+ Drizzle ORM 原生 vector 类型

**选择**：PostgreSQL + pgvector 扩展，Drizzle ORM 从 v0.31.0 起原生支持 pgvector 的 `vector` 类型，项目使用 `drizzle-orm: ^0.36.0`，直接使用原生支持即可。

**理由**：项目已用 PostgreSQL（Drizzle ORM），复用现有 DB 不引入新依赖。单机 PG + pgvector 完全够用，记忆数据量级（万级消息）远未到需要独立向量库（Qdrant/Milvus）的规模。Drizzle 原生支持 vector 列定义、HNSW 索引导出、以及 `cosineDistance()`/`l2Distance()`/`innerProduct()` 距离查询辅助函数，无需手写 customType。

**技术细节**：

1. **Docker 镜像**：当前 `docker-compose.yml` 使用 `postgres:18-alpine`（不带 pgvector 扩展）。需改为官方 pgvector 镜像（保持 PG 18 版本不变，避免大版本降级）：
   ```yaml
   # docker-compose.yml
   postgres:
     image: pgvector/pgvector:pg18
   test-postgres:
     image: pgvector/pgvector:pg18
   ```
   > ℹ️ **版本说明**：`pgvector/pgvector:pg18` 镜像已发布（Docker Hub `docker.io/pgvector/pgvector:pg18`），与项目当前 `postgres:18-alpine` 同为 PG 18，**无需 `docker compose down -v` 删除数据卷**（同版本数据卷兼容）。只需 `docker compose up -d` 重建容器（检测到 image 变化自动重建），再 `pnpm db:push` 同步 schema。现有 sessions/messages/feedbacks 数据全部保留。

2. **启用扩展**：`drizzle-kit push` 只做静态 schema 分析生成 DDL，不会执行 schema.ts 中的任意 JavaScript 代码。因此 `CREATE EXTENSION IF NOT EXISTS vector` 必须放在服务启动初始化阶段执行：在 `server/db/index.ts` 创建数据库连接后立即执行一次（幂等）：
   ```ts
   // server/db/index.ts（在现有 const sql = postgres(...) 和 export const db 之后追加）
   // 启用 pgvector 扩展（幂等，已存在时跳过）
   await sql`CREATE EXTENSION IF NOT EXISTS vector`
   ```
   注：现有代码中 postgres 客户端变量名为 `sql`（与 drizzle-orm 的 `sql` 模板同名但作用域不同，在本文件中 `sql` 是 postgres 客户端，可直接用 tagged template 执行原始 SQL）。

3. **原生 vector 列定义**：直接从 `drizzle-orm/pg-core` 导入 `vector` 和 `index`：
   ```ts
   import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'
   import { vector } from 'drizzle-orm/pg-core'

   export const memoryVectors = pgTable('memory_vectors', {
     id: text('id').primaryKey(),
     messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
     sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
     content: text('content').notNull(),
     embedding: vector('embedding', { dimensions: 1024 }).notNull(),
     role: text('role').notNull(),
     // created_at 引用消息原始创建时间（从 messages.created_at 复制），便于按时间检索历史记忆
     createdAt: timestamp('created_at').notNull(),
     // archived_at 是归档执行时间（defaultNow），与 created_at 区分：前者是消息产生时间，后者是入库时间
     archivedAt: timestamp('archived_at').notNull().defaultNow()
   }, (table) => [
     index('memory_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops'))
   ])
   ```
   > **HNSW 索引参数说明**：Drizzle ORM 的 `index().using('hnsw', ...)` API **不暴露 `WITH (m=..., ef_construction=...)` 子句**（经 context7 查询 Drizzle 官方文档确认）。生成的 SQL 为 `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`，使用 pgvector 的默认值 `m=16, ef_construction=64`（恰好与原设计预期一致）。不再通过环境变量覆盖（删除 `HNSW_M` / `HNSW_EF_CONSTRUCTION`）。如未来需调优，可在 `server/db/index.ts` 启动时用原始 SQL `DROP INDEX` + `CREATE INDEX ... WITH (...)` 重建索引。

4. **余弦距离查询**：使用 Drizzle 原生 `cosineDistance()` 辅助函数，参照 Drizzle 官方文档推荐写法（[vector-similarity-search.mdx](https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/guides/vector-similarity-search.mdx)），转换为相似度后用 `desc()` 排序：
   ```ts
   import { cosineDistance, desc, gt, sql } from 'drizzle-orm'

   // cosineDistance 返回余弦距离（0=最相似，2=最不相似）
   // 转换为相似度（1=最相似，-1=最不相似）便于排序和阈值过滤
   const similarity = sql<number>`1 - (${cosineDistance(memoryVectors.embedding, queryVector)})`

   const results = await db.select({
     content: memoryVectors.content,
     messageId: memoryVectors.messageId,
     sessionId: memoryVectors.sessionId,
     role: memoryVectors.role,
     distance: sql<number>`${cosineDistance(memoryVectors.embedding, queryVector)}`,
     similarity
   })
     .from(memoryVectors)
     .orderBy(desc(similarity))  // 相似度降序，最相似的在前
     .limit(20)
   ```
   > 注：pgvector 的 `<=>` 操作符返回余弦**距离**（0=最相似，2=最不相似）。`1 - distance` 映射为相似度（1=最相似）。召回阶段不做阈值过滤（top-20 全部传给 reranker 精排），阈值过滤在 reranker 阶段执行。
   > **避免重复计算**：`cosineDistance()` 在 `select` 和 `orderBy` 中各调用一次是 Drizzle 的标准写法（官方示例如此），Drizzle 会将其编译为同一 SQL 表达式，不会产生额外的性能开销。

5. **content 字段冗余说明**：`memory_vectors.content` 存储消息文本快照，而非通过 `message_id` JOIN `messages` 表获取。原因：①避免检索时 JOIN 开销；②消息删除（级联）时向量记录也删除，不存在数据不一致；③简化查询逻辑。这是可接受的冗余设计。

**替代方案**：独立向量库（Qdrant/Milvus/Chroma）——过度设计，新增运维复杂度，收益不抵成本。

### 决策 2：Embedding 模型选 `BAAI/bge-m3`

**选择**：`BAAI/bge-m3`（1024 维，8K 上下文，多语言，支持密集/多向量/稀疏检索）

**理由**：项目是中文为主但可能涉及英文内容（代码、文档）；8K 上下文比 `bge-large-zh-v1.5` 的 512 token 实用得多（单条长消息不会被截断）；多功能检索能力为后续优化留空间。

**替代方案**：`bge-large-zh-v1.5`（中文专用，精度略高但 512 token 太短，长消息需分块，复杂度上升）。

### 决策 3：引入重排序 `BAAI/bge-reranker-v2-m3`

**选择**：embedding 召回 top-20 → `bge-reranker-v2-m3` 精排 → 取 top-5

**理由**：RAG 标准配方（双阶段检索）。embedding 召回快但精度一般，reranker（568M，轻量）对 query-document 对做交叉编码精排，显著提升 top-K 准确率。两阶段延迟可控（embedding 检索 < 50ms，rerank < 200ms）。

**替代方案**：仅 embedding 检索——top-K 噪声大，LLM 可能被无关记忆误导。

### 决策 3.1：向量索引选 HNSW（默认创建，非"后续优化"）

**选择**：建表时同步创建 HNSW 索引（`vector_cosine_ops`），`m=16, ef_construction=64`

**理由**：pgvector 支持两种 ANN 索引：IVFFlat（需先建索引再导数据，适合大数据量）和 HNSW（即插即用，查询快，适合本项目读写都少的场景）。本项目记忆数据写入频率低（仅在会话切换时）、读取频率中（LLM 调用工具时），HNSW 最合适。索引随表创建，避免"后续优化"的遗忘风险。

```sql
CREATE INDEX ON memory_vectors USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

**替代方案**：IVFFlat（需训练数据，初始无数据时无法建索引）、不建索引（全表扫描，万级数据时延迟不可接受）。

### 决策 4：Agentic RAG 路径 A（工具 LLM 自主调用）

**选择**：`recall-memory` 作为 Agent 工具，在 `chat.post.ts` 注册，LLM 自主决定是否调用

**理由**：AGENTS.md 核心判定「LLM 自主决策 = Agent」。工具调用与否、何时调用应由 LLM 决定。用户问"1+1"时 LLM 不会调用检索，用户问"我上周问过 SSRF 怎么做"时 LLM 才调用——避免无关污染。

**替代方案**：路径 B（Workflow 预检索注入，每次请求先检索再注入 prompt）——违反 Agent 原则，无关问题也强制检索，浪费 token、污染上下文。AGENTS.md 明确「确需预检索的场景须在设计文档说明理由」，本场景无此必要。

### 决策 5：重要度筛选入库（会话结束时 LLM 判断）

**选择**：会话结束时，用一次轻量 LLM 调用判断会话内哪些消息值得长期记住，只对重要消息做 embedding 入库。

**理由**：用户明确选择此策略。避免全量入库的存储成本；LLM 判断重要度比规则启发式更智能；符合 Agent 架构（LLM 决策）。

**重要度判断实现细节**：
- **调用模型**：默认使用 `Qwen/Qwen3.5-4B`（轻量、支持工具调用、成本低，`toggleableThinking: true`），可通过环境变量 `MEMORY_IMPORTANCE_MODEL` 覆盖。
- **调用方式**：**复用项目现有 `createReasoningProvider()` + AI SDK v5 的 `generateText()`（非流式）**，保持与项目架构一致。通过 `llmProvider(modelId, { enableThinking: false })` 创建 provider，`enable_thinking: false` 由 `reasoning-provider.ts` 的 `createThinkingFetch` 在 customFetch 层注入（非调用方直接放请求体），与项目现有 `streamText` 调用路径一致。
  > ⚠️ **架构一致性**：不直接用 `fetch` 调用 API。原因：①项目 `enable_thinking` 注入逻辑封装在 `reasoning-provider.ts` 的 customFetch 层（project_memory 明确记录此约束）；②customFetch 还处理 developer→system 角色修复、reasoning_content 字段映射等兼容逻辑；③直接 fetch 会绕过这些修复，可能导致非流式响应中 reasoning_content 字段干扰 JSON 解析。`generateText` 走 Chat Completions API 非流式模式，customFetch 检测到响应非 `text/event-stream` 时直接透传，不影响 `generateText` 解析 `result.text`。
- **输入**：将会话内所有候选消息（按 `created_at` 升序）以 JSON 数组形式传入，每条包含 `id`、`role`、`content` 前 1000 字符（注：项目 `MAX_MESSAGE_LENGTH = 1000`，用户消息最长 1000 字符；assistant 消息不受此限，但截断到 1000 字符足够判断重要度）。
- **Prompt 要求**：
  - 判断标准：长期价值（用户偏好、技术决策、事实性信息、项目背景） vs 一次性/闲聊（问候、简单计算、纯知识问答）。
  - 输出格式：严格 JSON 数组，元素为 `{ "message_id": "...", "important": true/false, "reason": "..." }`。
- **参数**：`temperature: 0.1`（低随机性），`maxTokens: 4096`（预留足够 JSON 输出空间），`abortSignal` 30 秒超时。
- **超时**：通过 `generateText` 的 `abortSignal` 参数传入 `AbortController` 30 秒超时，超时则该次归档整体失败（记录日志，不影响对话）。
- **失败降级**：若 LLM 返回无法解析（含 `<think>` 标签、JSON 截断、格式错误等），默认该会话所有消息判为非重要，不入库（避免污染记忆库）。

**替代方案**：全量入库（成本高、噪声大）、用户手动收藏（需用户操作、体验差）、每条消息实时判断（频繁 LLM 调用、成本高）。

### 决策 6：「会话结束」触发机制——会话切换时异步入库 + 服务端兜底

**选择**：新增后端 API `POST /api/sessions/:id/archive-memory`，前端在用户切换会话或新建会话时，对「上一个会话」调用该接口。接口异步执行重要度判断 + embedding 入库，不阻塞对话。同时，服务端在每次收到 `/api/chat` 请求时，对「非当前会话的上一个活跃会话」也异步检查一次归档状态，作为浏览器关闭/刷新场景的兜底。

**理由**：当前项目无显式「会话结束」事件，用户切换会话是自然的「上一个会话告一段落」信号。重要度筛选入库本质是消息持久化操作，按 AGENTS.md「消息持久化走 Workflow」原则，用代码编排（非 LLM 工具）合理。但纯前端触发无法覆盖标签页关闭场景，因此需要服务端兜底。

**触发入口**：
1. **前端触发**：`useChatSession` composable 的 `switchSession()` 和 `createNewSession()` 两个方法中，**在修改 `currentSessionId.value` 之前**先保存旧值 `const previousSessionId = currentSessionId.value`，对 `previousSessionId` 异步调用归档 API（fire-and-forget，不 await 完成，`.catch(console.error)` 兜底，不阻塞切换）。**首次加载时 `currentSessionId` 为空字符串，不触发归档**。前端同时在 `/api/chat` 请求 body 中传入 `lastSessionId` 字段（即切换前的会话 ID），供服务端兜底使用。`lastSessionId` 需通过 ref 维护，在会话切换时更新为 `previousSessionId`，并在 `useChat` 的 `body` computed 中读取（遵循 AGENTS.md「useChat body 必须用 computed 包裹」规则）。
2. **服务端兜底**：`server/api/chat.post.ts` 从请求 body 读取 `lastSessionId`（前端传入的上一个会话 ID），在 `onFinish` 回调中除了保存当前消息外，若 `lastSessionId` 存在且不等于当前 `sessionId`，则**fire-and-forget** 触发该会话的归档（启动归档 Promise 但**不 await 完成**，用 `.catch(console.error)` 兜底，不阻塞 `onFinish` 返回和流结束信号）。不使用服务端全局缓存/Map 来追踪会话状态——保持服务端无状态，所有上下文通过请求参数传递，避免并发场景下状态不一致。
   > ⚠️ **fire-and-forget 语义**：`onFinish` 中只启动归档任务但不等待完成。归档是异步后台操作，可能耗时数十秒（LLM 重要度判断 + embedding）。若 `await` 归档完成会延迟流的 `finish` 事件，导致前端长时间等待。现有的 `await saveMessagesToDb(...)` 是必要的同步持久化（快），归档则是可异步的增强操作（慢）。

**已知局限及缓解**：
- 用户关闭浏览器标签页 → 最后一个会话可能延迟归档。缓解：服务端兜底会在用户下一次发起任意 `/api/chat` 请求时触发；若用户永远不返回，则内容仍保留在 `messages` 表中，属于可接受的数据未提升为“长期记忆”，不会丢失原始对话。
- 用户长时间停留一个会话不切换 → 该会话内容不会归档。缓解：同上，用户下次切换或发送新消息时触发归档。
- 切回正在归档的会话 → 归档异步进行中，切换操作不受影响；归档写入时 `memory_vectors` 已有该消息记录，切换回来时检索即可获取。

**替代方案**：显式「结束会话」按钮（需新增前端 UI，增加用户操作负担）、每条消息后判断（不符合用户选择的「会话结束」时机）、超时触发（不可靠）。

**参数校验与错误处理**：
- 路径参数 `id`：校验非空、为标准 UUID v4 格式，不存在返回 404。
  - 注意：现有 `server/middleware/security.ts` 的 UUID 正则只匹配 `/api/sessions/:id`（单段路径），`archive-memory` 是多段路径，因此需在路由文件内自行校验，或同步扩展中间件正则。
- **进程内并发锁**：使用 `Map<string, Promise<void>>` 记录正在归档的 sessionId，同一会话的归档请求若已有进行中的 Promise，则直接返回不重复执行（前端防重复 + API 层双重守卫，避免前端触发和服务端兜底同时命中导致 LLM 重复调用）。
- 重复归档守卫：以 `message_id` 为粒度判断。归档前查询 `memory_vectors`，只对该会话中尚未存在记录的消息执行 LLM 重要度判断和 embedding；已入库的消息直接跳过。这样即使某次归档中断，下次也能继续补齐剩余消息。
- LLM 重要度判断失败：记录错误日志，该次归档整体跳过（不入库，下次重试），不抛异常，不影响对话。
- Embedding API 失败：记录错误日志，跳过该条消息，继续处理其他消息。
- 会话删除并发：若归档进行中用户删除了会话，`memory_vectors` 外键级联删除会自动清理已写入记录；归档 API 的后续写入会因外键约束失败（记录日志，不抛异常）。

### 决策 7：入库粒度——消息级

**选择**：以单条消息为粒度做 embedding 入库

**理由**：简单、可追溯（检索结果能定位到具体消息 + 来源会话）、符合现有 `messages` 表结构。会话级粒度太粗（一个会话可能跨多主题），段落级需额外分块逻辑（复杂）。

### 决策 8：recall-memory 工具使用说明注入 system prompt

**选择**：在 `chat.post.ts` 中，当 `caps.toolCalling` 为 true 时，向 system prompt 追加 recall-memory 工具使用规则（类似 OCR 工具规则注入模式）

**理由**：仅靠 `tool.description` 不足以让 LLM 在合适的时机调用工具。system prompt 中明确说明"何时调用"（用户提及过去会话内容、历史偏好、之前的讨论等）和"何时不调用"（当前会话内的问题、纯知识问答），能显著提升工具调用准确率。参考 OCR 工具规则（[chat.post.ts#L143-L164](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L143-L164)）的注入模式。

**Prompt 设计要点**：
- 触发条件：用户问题涉及"之前""上次""历史""过去""以前说过"等关键词，或需要回忆用户偏好/决策
- 不触发条件：当前会话内的追问、纯知识问答、1+1 等简单计算
- 调用后行为：基于检索结果回答，引用来源（"根据你之前提到的…"）

### 决策 9：前端 ToolInvocation 组件新增 recall-memory 分支

**选择**：在 `components/chat/ToolInvocation.vue` 中新增 `recall-memory` 工具展示分支

**理由**：项目记忆要求"ToolInvocation component must have explicit branches for each tool type"。新增 `recall-memory` 工具后，前端需展示检索状态（检索中/检索完成/无结果），让用户感知 AI 正在回忆历史内容。不新增分支会导致工具调用被当作"未知工具"渲染或完全不可见。

**展示内容**：检索中显示"正在回忆历史记忆…"spinner，检索完成后显示"已检索 X 条相关记忆"，无结果显示"未找到相关历史记忆"。

### 决策 10：Embedding / Reranker API 端点

**选择**：硅基流动 base URL `https://api.siliconflow.cn/v1`，复用 `OPENAI_API_KEY` header 鉴权

- **Embedding**：`POST /v1/embeddings`，model=`BAAI/bge-m3`，兼容 OpenAI Embeddings API 格式，返回 1024 维向量。
- **Reranker**：`POST /v1/rerank`，model=`BAAI/bge-reranker-v2-m3`，request body 格式为 `{ model, query, documents, top_n, return_documents: true }`。必须传 `return_documents: true`，否则响应中不包含 document 文本（默认 false，仅返回 index 和 relevance_score）。响应中分数字段为 `results[i].relevance_score`（0-1 浮点数，越高越相关）。

**理由**：硅基流动 API 兼容 OpenAI 格式，`OPENAI_API_KEY` 可直接用于鉴权。Embedding 和 Reranker 使用同一 base URL 但不同端点，无需额外配置 base URL。

**环境变量与配置读取**：
- 复用 `OPENAI_API_KEY`（不新增 `SILICONFLOW_API_KEY`），但在服务端通过 `useRuntimeConfig().openAiApiKey` 读取，而非直接读取 `process.env`，以符合项目 `nuxt.config.ts` 的 runtimeConfig 约定。
- base URL 通过 `useRuntimeConfig().openAiBaseUrl` 读取，默认回退到 `https://api.siliconflow.cn/v1`，不硬编码。
- embedding 模型名、reranker 模型名纳入环境变量 `EMBEDDING_MODEL` / `RERANKER_MODEL`（可选，默认分别为 `BAAI/bge-m3` / `BAAI/bge-reranker-v2-m3`），并在 `nuxt.config.ts` 的 runtimeConfig 中声明，便于不同环境切换模型。
- 在 `.env.example` 中新增上述可选变量说明。

### 决策 11：入库角色过滤与敏感信息处理

**选择**：对 `role='user'` 和 `role='assistant'` 的消息文本进行重要度判断；跳过 `role='system'` 消息（如存在）。同时增加基础敏感信息过滤，对疑似包含密码/API Key/Token 的内容跳过 embedding。

**理由**：
- 经审查 `server/api/chat.post.ts` 的 `saveMessagesToDb` 函数，存入 `messages` 表的 assistant 消息是最终回答文本（已移除 reasoning 思考内容），工具调用结果（weather/OCR/webSearch 输出）不会作为独立消息存入 `messages` 表——它们通过流式响应传给前端但不持久化。因此归档时从 `messages` 表读取的数据中只有 user 和 assistant 两种角色的文本内容，无需额外过滤"工具调用结果消息"。
- system 消息是服务端提示词，不属于用户需要回忆的内容。
- 用户可能在对话中无意输入敏感信息，需做基础防护。

**过滤规则**：
- 角色排除：仅排除 `role='system'` 的消息（实际上该角色消息通常不会出现在用户产生的 messages 中，但做防御性过滤）。
- 敏感信息启发式：内容匹配 `sk-[a-zA-Z0-9]{20,}`、`api[_-]?key[:=]\s*\S+`、`password[:=]\s*\S+`、`token[:=]\s*\S+` 等正则时，跳过该条消息并记录日志。
- 长度过滤：`content` 为空或纯空白、长度小于 5 个字符的消息跳过。

### 决策 12：检索阈值与 top-K 参数

**选择**：embedding 召回 top-20（余弦距离排序）→ reranker 精排 → 取 top-5；增加 reranker 分数阈值，低于阈值时视为无相关记忆。返回结果包含 `score` 字段（reranker 分数或余弦距离转换值），便于 LLM 判断记忆相关程度。

**参数**：
- 召回阶段：`top_k = 20`，使用 Drizzle 原生 `cosineDistance()` + pgvector 的 `<=>` 余弦距离算子，按距离升序取 top-20。pgvector 的余弦距离范围为 [0, 2]，0=最相似，2=最不相似。
- 精排阶段：`top_n = 5`，调用 `BAAI/bge-reranker-v2-m3`，传 `return_documents: true`。
- 阈值：最终返回的 reranker `relevance_score` 低于 `0.3`（可根据实测调整）时，视为无相关记忆，返回空数组。
- 返回结构：每条记忆包含 `content`、`message_id`、`session_id`、`role`、`score`（reranker 分数，0-1）。
- reranker 失败降级：直接返回 embedding 召回结果中距离最近的 top-5，不设阈值（仅做数量截断），并记录警告日志。降级时 `score` 字段使用余弦距离转换值 `1 - distance/2`（映射到 0-1 区间，1=最相似）。
- embedding 超长文本：不做客户端截断，直接将文本传给硅基流动 embedding API，由 API 自行处理超长输入（API 会自动截断到模型支持长度），仅在文本超过约 8K token 时记录警告日志。

### 决策 13：HNSW 索引参数

**选择**：建表时同步创建 HNSW 索引（`vector_cosine_ops`），使用 pgvector 默认参数 `m=16, ef_construction=64`。**不暴露环境变量覆盖**（Drizzle ORM 的 `index().using('hnsw', ...)` API 不支持 `WITH` 子句，详见决策 1 第 3 点说明）。

**理由**：HNSW 适合写入少、查询中的场景。pgvector 默认值 `m=16, ef_construction=64` 恰好是业界通用推荐值，对本项目万级数据量完全够用。如未来数据规模增长需调优，可在 `server/db/index.ts` 启动时用原始 SQL `DROP INDEX` + `CREATE INDEX ... WITH (m=..., ef_construction=...)` 重建索引（脱离 Drizzle schema 管理）。

## Risks / Trade-offs

| 风险 | 缓解 |
| --- | --- |
| 重要度判断 LLM 调用增加成本和延迟 | 用轻量模型（Qwen3.5-4B 关闭思考 enable_thinking: false）；异步执行不阻塞对话；进程内并发锁 + 消息级幂等守卫避免重复调用 |
| Docker 镜像切换涉及 PG 大版本变更 | 使用 `pgvector/pgvector:pg18` 镜像（与当前 `postgres:18-alpine` 同为 PG 18，无需 `docker compose down -v`，数据卷兼容）；扩展在 db/index.ts 启动时自动启用 |
| bge-m3 embedding 超长输入 | 不做客户端截断，由硅基流动 API 自行截断处理；超长时仅记录警告日志 |
| 记忆无用户隔离，多用户场景下隐私问题 | 当前项目无用户系统，属可接受现状；后续引入用户系统时再隔离 |
| 重排序 API 失败导致检索降级 | 重排序失败时降级为仅 embedding 余弦距离检索结果（top-5，score 映射为 1-distance/2），不中断流程 |
| 会话切换时归档未完成用户又切回 | 进程内并发锁 + 消息级幂等；未完成时该会话内容暂未入库，不影响正确性 |
| 归档进行中用户删除会话 | `memory_vectors` 外键级联删除自动清理已写入记录；后续写入因外键约束失败（记录日志不抛异常） |
| 用户关闭浏览器导致最后一个会话延迟归档 | 前端传 `lastSessionId` + 服务端 `/api/chat` onFinish 兜底；若用户永远不返回，原始对话仍保留在 `messages` 表 |
| 敏感信息（密码/API Key）被误入库 | 基础正则启发式过滤；明确记录为可接受的基础防护，非绝对安全 |
| Qwen3.5-4B 思考模式未关闭导致 JSON 解析失败 | 通过 `createReasoningProvider` + `generateText` + `{ enableThinking: false }` 在 customFetch 层注入 `enable_thinking: false`（架构一致）；解析失败时整体降级为不入库 |

## Migration Plan

1. **Docker 调整**：修改 `docker-compose.yml`，将 `postgres` 和 `test-postgres` 服务镜像切换为 `pgvector/pgvector:pg18`（与当前 `postgres:18-alpine` 同为 PG 18，**无需 `docker compose down -v`**，数据卷兼容）。执行 `docker compose up -d` 重建容器（检测到 image 变化自动重建），现有数据全部保留。
2. **DB 迁移**：
   - 在 `server/db/index.ts` 数据库连接初始化后添加 `CREATE EXTENSION IF NOT EXISTS vector`（幂等执行）；
   - 在 `server/db/schema.ts` 中新增 `memoryVectors` 表（使用 Drizzle 原生 `vector({ dimensions: 1024 })` 类型，含 `archived_at` 字段，HNSW 索引通过第二个参数回调定义）；
   - 运行 `pnpm db:push` 同步 schema（开发库和测试库都需要）；
   - 测试数据库（5433端口）同样需要重建容器并 db:push。
3. **runtimeConfig 扩展**：在 `nuxt.config.ts` 新增 `embeddingModel`、`rerankerModel`、`memoryImportanceModel` 等非 public 字段；同步更新 `.env.example`（不再新增 `hnswM`/`hnswEfConstruction`，HNSW 使用 pgvector 默认参数，详见决策 13）
4. **后端服务与工具**：新增 `server/utils/embedding.ts`（embedding 服务，超长文本交由 API 截断）、`server/utils/reranker.ts`（重排序服务，传 return_documents: true）、`server/tools/recall-memory.ts`（检索工具，返回结果含 score）、`server/utils/memory-archive.ts`（归档逻辑，重要度判断复用 `createReasoningProvider` + `generateText` + `{ enableThinking: false }`，含进程内并发锁）
5. **注册工具 + prompt 注入**：在 `chat.post.ts` 的 `toolsConfig` 注册 `recallMemoryTool`（仅对支持工具调用的模型启用）；追加 recall-memory 使用规则到 system prompt；在请求 body 中读取 `lastSessionId`，在 `onFinish` 中 fire-and-forget 触发服务端归档兜底（不 await 完成，`.catch(console.error)` 兜底）
6. **归档 API**：新增 `server/api/sessions/[id]/archive-memory.post.ts`，内部自行校验 UUID 格式，使用 `Map<string, Promise<void>>` 实现进程内并发锁
7. **前端触发**：在 `useChatSession` 的 `switchSession()` 和 `createNewSession()` 中，**在修改 `currentSessionId.value` 之前**先保存旧值 `previousSessionId`，对非空的 `previousSessionId` fire-and-forget 调用归档 API（不 await 完成，`.catch(console.error)` 兜底）；维护 `lastSessionId` ref 并在 `useChat` 的 `body` computed 中传入 `/api/chat` 请求
8. **前端展示**：在 `components/chat/ToolInvocation.vue` 新增 `recall-memory` 分支
9. **文档同步**：更新 `docs/db-schema.md`（新增 `memory_vectors` 表含 `archived_at` 字段）、`docs/API.md`（新增 `POST /api/sessions/:id/archive-memory`）
10. **回滚策略**：若发现问题，移除 `recall-memory` 工具注册即可禁用检索（向量表数据保留不影响）；归档 API 移除后不影响对话主流程

## Open Questions

- `[不确定]` 是否需要在前端展示「已归档记忆」状态提示（如会话列表标记），本期 Non-Goals 但值得评估
- `[不确定]` 记忆检索的 top-K / top-N / 阈值参数需实测调优（当前预估召回 20、精排取 5、阈值 0.3）
- `[不确定]` 硅基流动 embedding API 的速率限制需实测确认（影响批量归档速度）
- `[不确定]` 敏感信息过滤的正则规则是否足够覆盖常见场景，需根据实际数据评估
