# long-term-memory

## Purpose

长期记忆系统——会话结束时按重要度筛选入库（embedding + 向量存储），LLM 通过 `recall-memory` 工具自主检索跨会话历史，检索结果经重排序精排后返回（含 score 分数）。

## Requirements

### Requirement: 记忆重要度筛选入库

系统 SHALL 在会话切换时对上一个会话触发重要度筛选入库流程：用 LLM 判断会话内消息的重要度，仅对重要消息调用 embedding 服务转向量并存入 `memory_vectors` 表。入库为 Workflow（消息持久化类），非 LLM 自主调用的工具。系统还 SHALL 在服务端 `/api/chat` 流程中通过前端传入的 `lastSessionId` 做兜底触发，覆盖浏览器关闭/刷新场景；服务端保持无状态，不使用全局缓存追踪会话状态。

#### Scenario: 会话切换触发归档

- **WHEN** 用户切换到另一个会话或新建会话
- **THEN** 前端在修改 `currentSessionId.value` **之前**先保存旧值 `previousSessionId`，对非空的 `previousSessionId` fire-and-forget 调用 `POST /api/sessions/:id/archive-memory` 触发重要度筛选入库（不 await 完成，`.catch(console.error)` 兜底，不阻塞切换）
- **AND** 首次加载 `currentSessionId` 为空字符串时不触发归档
- **AND** 前端维护 `lastSessionId` ref（更新为 `previousSessionId`），在 `pages/ai-chat.vue` 的 `DefaultChatTransport.body` 函数中追加 `lastSessionId: lastSessionId.value` 字段传入 `/api/chat` 请求供服务端兜底（项目使用 `new Chat()` + `DefaultChatTransport`，非 `useChat` composable）
- **AND** 归档异步执行，不阻塞用户在新会话中的对话

#### Scenario: 服务端兜底触发归档

- **WHEN** 用户发送消息时，请求 body 中包含 `lastSessionId` 且该值不等于当前 `sessionId`
- **THEN** `server/api/chat.post.ts` 在 `onFinish` 回调中**fire-and-forget** 触发该 `lastSessionId` 会话的归档（启动归档 Promise 但不 await 完成，`.catch(console.error)` 兜底）
- **AND** 该兜底不阻塞当前对话流返回和流结束信号

#### Scenario: 重要内容被筛选入库

- **WHEN** 归档流程判断某条消息包含值得长期记住的内容（如事实性信息、用户偏好、技术决策）
- **THEN** 系统调用 `BAAI/bge-m3` 对该消息内容生成 1024 维 embedding
- **AND** 将 embedding、消息 ID、会话 ID、消息内容快照、消息角色、`archived_at` 时间戳存入 `memory_vectors` 表

#### Scenario: 非重要内容不入库

- **WHEN** 归档流程判断某条消息为闲聊、一次性问题、无长期价值内容
- **THEN** 系统不对该消息生成 embedding
- **AND** 该消息不写入 `memory_vectors` 表

#### Scenario: 重要度判断关闭思考模式

- **WHEN** 归档流程调用 LLM 做重要度判断
- **THEN** 系统复用项目现有 `createReasoningProvider()` + AI SDK v5 `generateText()`（非流式），通过 `llmProvider(modelId, { enableThinking: false })` 创建 provider
- **AND** `enable_thinking: false` 由 `reasoning-provider.ts` 的 `createThinkingFetch` 在 customFetch 层注入（非调用方直接放请求体），保持与项目现有 `streamText` 调用路径架构一致
- **AND** 参数 `temperature: 0.1`，`maxOutputTokens: 4096`（AI SDK v5 参数名，非 `maxTokens`）
- **AND** 通过 `generateText` 的 `abortSignal` 参数传入 30 秒超时控制，超时整体跳过

#### Scenario: 重要度判断失败降级

- **WHEN** LLM 返回内容无法解析为 JSON（含 `thinking` 标签、格式错误、截断等）
- **THEN** 系统整体跳过该次归档（不入库）
- **AND** 记录错误日志，下次触发时可重试

#### Scenario: 重复归档守卫（消息级幂等）

- **WHEN** 归档 API 被调用
- **THEN** 系统先查询 `memory_vectors` 中已存在的 `message_id` 集合
- **AND** 仅对尚未入库的消息执行 LLM 重要度判断和 embedding
- **AND** 已入库的消息直接跳过，**不进入 LLM 重要度判断、不调用 embedding 服务**，避免重复成本

#### Scenario: 进程内并发锁防重复执行

- **WHEN** 同一会话的归档请求已在执行中（前端触发和服务端兜底同时命中）
- **THEN** 后续请求直接返回，不重复执行 LLM 重要度判断
- **AND** 使用 `Map<string, Promise<void>>` 实现进程内锁

#### Scenario: 归档失败不阻断对话

- **WHEN** 归档流程中 LLM 重要度判断失败/超时或单条消息 embedding API 报错
- **THEN** embedding 失败的单条消息跳过、继续处理其他消息；LLM 判断失败则整体跳过、记录日志
- **AND** 不向用户抛出错误，不影响对话主流程

#### Scenario: 归档进行中会话被删除

- **WHEN** 归档 API 正在写入 `memory_vectors` 表时，用户删除了该会话
- **THEN** `memory_vectors` 中已写入的记录因外键级联删除被自动清理
- **AND** 后续写入因外键约束失败，记录错误日志，不抛出异常

#### Scenario: 关闭浏览器后最后一个会话延迟归档

- **WHEN** 用户在一个会话中对话后直接关闭浏览器标签页（未切换会话）
- **THEN** 该会话不会立即归档
- **AND** 会话内容保留在 `messages` 表中
- **AND** 用户下次发送任意 `/api/chat` 请求时，前端传入 `lastSessionId`，服务端兜底触发该会话归档
- **AND** 重复归档守卫跳过已入库内容，不产生额外成本

#### Scenario: 系统消息不入库

- **WHEN** 归档流程扫描会话消息时遇到 `role='system'` 消息
- **THEN** 系统直接跳过这些消息，不进入重要度判断和 embedding
- **AND** 这些消息不写入 `memory_vectors` 表
- **NOTE** messages 表中仅持久化 user 和 assistant 消息的最终文本（不含独立工具调用结果消息），无需额外过滤工具调用结果

#### Scenario: 疑似敏感信息跳过入库

- **WHEN** 某条 `role='user'` 消息内容匹配敏感信息正则（如 `sk-...` API Key、`password=...`、`api_key=...`、`token=...`）
- **THEN** 系统跳过该消息的重要度判断和 embedding（**仅对 user 消息过滤，assistant 消息不过滤**，避免误杀编程助手的代码回答）
- **AND** 记录一条警告日志标注该消息因敏感信息被过滤

#### Scenario: 过短内容跳过入库

- **WHEN** 某条消息 `content` 为空、纯空白或长度小于 5 个字符
- **THEN** 系统跳过该消息，不进入重要度判断和 embedding

#### Scenario: API 路径参数 UUID 校验

- **WHEN** 请求 `POST /api/sessions/:id/archive-memory` 且 `:id` 不是标准 UUID v4 格式
- **THEN** 接口返回 400 Bad Request，响应体包含 `{ message: "无效的会话 ID" }`
- **AND** 不执行后续归档逻辑

### Requirement: 长期记忆检索工具（recall-memory）

系统 SHALL 提供 `recall-memory` Agent 工具，由 LLM 自主决定是否调用、检索什么内容。工具接收查询文本，经 embedding 余弦距离检索 + 重排序精排后返回相关历史记忆（含 score 分数）。工具仅在模型支持工具调用（`caps.toolCalling`）时注册。

#### Scenario: LLM 自主调用检索历史记忆

- **WHEN** 用户提问涉及过去会话内容（如"我上周问过 SSRF 怎么做"），LLM 判断需要回忆
- **THEN** LLM 调用 `recall-memory` 工具，传入查询文本
- **AND** 工具返回与查询语义相关的历史消息内容、来源会话信息及相关度分数

#### Scenario: 检索结果经重排序精排

- **WHEN** `recall-memory` 工具被调用
- **THEN** 系统先用 `BAAI/bge-m3` 把查询文本转 1024 维向量
- **AND** 使用 Drizzle 原生 `cosineDistance()` 在 `memory_vectors` 表做余弦距离检索，召回距离最小的 top-20（距离 0=最相似）
- **AND** 调用 `BAAI/bge-reranker-v2-m3`（请求体含 `return_documents: true`）对召回结果重排序
- **AND** 返回 reranker `relevance_score` 最高的 top-5（分数 ≥ 0.3）
- **AND** 返回结果每条包含 `content`、`message_id`、`session_id`、`role`、`score`（reranker 分数，0-1，1=最相关）

#### Scenario: 无相关记忆时返回空

- **WHEN** `memory_vectors` 表无数据，或召回/精排后所有结果 reranker 分数均低于 0.3
- **THEN** 工具返回 `{ memories: [], message: "未找到相关历史记忆" }`
- **AND** 不抛出异常，由 LLM 决定如何回应

#### Scenario: 重排序失败降级

- **WHEN** 重排序 API 调用失败
- **THEN** 系统降级为仅返回 embedding 余弦距离检索的 top-5 结果（按距离升序）
- **AND** 记录警告日志，不中断检索流程
- **AND** 降级结果不设分数阈值
- **AND** 降级时 `score` 字段使用 `1 - distance/2` 映射到 0-1 区间（1=最相似）

#### Scenario: 不支持工具调用的模型不注册检索工具

- **WHEN** 当前模型 `caps.toolCalling` 为 false（如 DeepSeek-R1、GLM-Z1）
- **THEN** `recall-memory` 工具不注册到 `toolsConfig`
- **AND** 该模型无法检索长期记忆（符合现有工具注册逻辑）

#### Scenario: System prompt 注入 recall-memory 使用规则

- **WHEN** 当前模型 `caps.toolCalling` 为 true
- **THEN** 系统向 system prompt 追加 recall-memory 工具使用规则
- **AND** 规则说明：用户提及过去会话内容/历史偏好/之前的讨论时调用，当前会话内追问/纯知识问答时不调用
- **AND** 调用后应基于检索结果回答，引用来源（"根据你之前提到的…"）

#### Scenario: 前端展示检索状态

- **WHEN** LLM 调用 `recall-memory` 工具
- **THEN** 前端 `ToolInvocation` 组件显示检索中状态（"正在回忆历史记忆…"spinner）
- **AND** 检索完成后显示"已检索 X 条相关记忆"
- **AND** 无结果时显示"未找到相关历史记忆"

### Requirement: Embedding 服务

系统 SHALL 提供 embedding 服务，调用硅基流动 embedding 模型（默认 `BAAI/bge-m3`）把文本转为 1024 维向量。base URL、API Key、模型名均从 `nuxt.config.ts` runtimeConfig 读取。

#### Scenario: 文本转向量成功

- **WHEN** 系统调用 embedding 服务，传入非空文本
- **THEN** 服务读取 `useRuntimeConfig().embeddingModel`（默认 `BAAI/bge-m3`）
- **AND** 使用 `useRuntimeConfig().openAiBaseUrl` 和 `useRuntimeConfig().openAiApiKey` 调用 embedding API
- **AND** 返回 1024 维浮点数向量

#### Scenario: 长文本交由 API 处理

- **WHEN** 传入文本超过模型支持长度（8K token）
- **THEN** 服务不做客户端截断，直接将文本传给硅基流动 API，由 API 自行截断处理
- **AND** 当文本长度超过约 6000 字符（近似 8K token）时记录警告日志

#### Scenario: Embedding API 失败

- **WHEN** 硅基流动 embedding API 返回非 200 状态码或网络超时
- **THEN** 服务返回 `{ error: "embedding 服务不可用", detail: <错误信息> }`
- **AND** 不抛出异常，由调用方决定降级策略

### Requirement: 重排序服务

系统 SHALL 提供重排序服务，调用硅基流动 reranker 模型（默认 `BAAI/bge-reranker-v2-m3`）对 query-document 对做交叉编码精排。

#### Scenario: 重排序成功返回精排结果

- **WHEN** 系统传入 query 和 documents 数组调用 reranker
- **THEN** 请求体必须包含 `return_documents: true`（否则响应不含文档文本）
- **AND** 解析响应 `results[i].relevance_score` 字段（0-1 浮点数，越高越相关）
- **AND** 按 relevance_score 降序返回精排结果

#### Scenario: 重排序 API 失败

- **WHEN** 硅基流动 reranker API 返回非 200 状态码或网络超时
- **THEN** 服务返回 null，由调用方降级为仅 embedding 检索结果

### Requirement: 向量存储表

系统 SHALL 在 PostgreSQL 中新建 `memory_vectors` 表存储记忆向量，使用 Drizzle ORM 原生 `vector({ dimensions: 1024 })` 类型（项目 drizzle-orm ^0.36.0 已支持 pgvector）存储 embedding，并在 pgTable 回调中创建 HNSW 索引加速余弦距离检索。系统 SHALL 在 `server/db/index.ts` 服务启动时幂等执行 `CREATE EXTENSION IF NOT EXISTS vector` 以启用扩展（非 schema.ts 中执行）。

#### Scenario: pgvector 扩展自动启用

- **WHEN** 服务启动并创建数据库连接
- **THEN** 立即执行 `CREATE EXTENSION IF NOT EXISTS vector`（幂等，已存在时跳过）
- **AND** `memory_vectors` 表的 `vector(1024)` 类型可正常创建
- **AND** 切换 Docker 镜像到 `pgvector/pgvector:pg18`（与当前 `postgres:18-alpine` 同为 PG 18，无需 `docker compose down -v`，数据卷兼容）

#### Scenario: 向量表创建含 HNSW 索引

- **WHEN** 系统初始化 `memory_vectors` 表
- **THEN** 表包含 HNSW 索引（`index('memory_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops'))`）
- **AND** 使用 pgvector 默认参数 `m=16, ef_construction=64`（Drizzle ORM API 不支持 `WITH` 子句，不通过环境变量覆盖）
- **AND** 后续检索时自动使用该索引加速

#### Scenario: 向量入库

- **WHEN** 归档流程对某条重要消息完成 embedding
- **THEN** 系统向 `memory_vectors` 表插入一条记录，包含：`id`（UUID）、`message_id`（外键关联 `messages.id`，级联删除）、`session_id`（外键关联 `sessions.id`，级联删除）、`content`（消息文本快照）、`embedding`（1024 维向量）、`role`（消息角色）、`created_at`（**从 `messages.created_at` 复制**，消息原始创建时间，便于按时间检索历史记忆）、`archived_at`（归档执行时间，`defaultNow()`）
- **AND** 插入成功后该消息可被检索

#### Scenario: 删除会话级联删除记忆

- **WHEN** 用户删除一个会话
- **THEN** `memory_vectors` 表中该会话的所有记忆记录被级联删除（`onDelete: 'cascade'`）
- **AND** 不残留孤立向量

#### Scenario: 向量余弦距离检索

- **WHEN** `recall-memory` 工具传入查询向量
- **THEN** 系统在 `memory_vectors` 表执行余弦距离检索（使用 Drizzle `cosineDistance()` 辅助函数 + pgvector `<=>` 算子，ORDER BY 距离 ASC）
- **AND** 返回 top-20 结果（含 content、message_id、session_id、role、distance 距离值）