## 1. 数据库基础设施

- [ ] 1.1 修改 `docker-compose.yml`，将 `postgres` 和 `test-postgres` 服务镜像切换为 `pgvector/pgvector:pg18`（与当前 `postgres:18-alpine` 同为 PG 18，无需 `docker compose down -v`，数据卷兼容）；执行 `docker compose up -d` 重建容器即可
- [ ] 1.2 在 `server/db/index.ts` 中，数据库连接创建后立即执行 `CREATE EXTENSION IF NOT EXISTS vector` SQL 语句（使用 postgres 客户端的 tagged template 语法，幂等执行，已存在时跳过）；验证服务启动时扩展自动启用
- [ ] 1.3 修改 `server/db/schema.ts`：导入 Drizzle 原生 `vector`（from `drizzle-orm/pg-core`），新增 `memoryVectors` 表（字段：`id` 主键、`message_id` 外键→messages.id 级联删除、`session_id` 外键→sessions.id 级联删除、`content` text NOT NULL、`embedding` 使用 `vector({ dimensions: 1024 })` NOT NULL、`role` text NOT NULL、`created_at` timestamp NOT NULL **从 messages.created_at 复制（非 defaultNow）**、`archived_at` timestamp NOT NULL defaultNow()）
- [ ] 1.4 在 pgTable 第二个参数回调中创建 HNSW 向量索引（`index('memory_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops'))`），**使用 pgvector 默认参数（m=16, ef_construction=64），不通过环境变量覆盖**（Drizzle API 不支持 WITH 子句，详见 design.md 决策 13）
- [ ] 1.5 运行 `pnpm db:push` 同步 schema 到开发数据库和测试数据库，验证表 + 索引创建成功
- [ ] 1.6 同步更新 `docs/db-schema.md` 记录 `memory_vectors` 表结构（含 `archived_at` 字段）

## 2. 配置扩展

- [ ] 2.1 在 `nuxt.config.ts` runtimeConfig 新增非 public 字段：`embeddingModel`、`rerankerModel`、`memoryImportanceModel`（**不再新增 `hnswM`/`hnswEfConstruction`**，HNSW 使用 pgvector 默认参数）
- [ ] 2.2 在 `.env.example` 中新增对应可选环境变量说明（默认值：embedding=`BAAI/bge-m3`、reranker=`BAAI/bge-reranker-v2-m3`、importance=`Qwen/Qwen3.5-4B`）
- [ ] 2.3 运行 `pnpm lint` + `pnpm typecheck` 验证配置类型

## 3. Embedding 服务

- [ ] 3.1 新增 `server/utils/embedding.ts`，封装硅基流动 embedding 调用：从 `useRuntimeConfig()` 读取模型名、base URL、API Key，默认模型 `BAAI/bge-m3`，验证返回 1024 维向量
- [ ] 3.2 不做客户端截断：直接将文本传给 API，由硅基流动 API 自行处理超长输入；仅在文本长度异常长（> 6000 字符，近似 8K token）时记录警告日志
- [ ] 3.3 实现 API 失败降级（返回 `{ error, detail }` 不抛异常，遵循项目工具错误返回模式）
- [ ] 3.4 运行 `pnpm lint` + `pnpm typecheck` 验证

## 4. 重排序服务

- [ ] 4.1 新增 `server/utils/reranker.ts`，封装硅基流动 reranker 调用：从 `useRuntimeConfig()` 读取模型名、base URL、API Key，默认模型 `BAAI/bge-reranker-v2-m3`，接收 query + documents 返回精排结果
- [ ] 4.2 请求体必须包含 `return_documents: true`；解析响应时使用 `results[i].relevance_score` 字段（不是 score）
- [ ] 4.3 实现 API 失败降级（返回 null，调用方降级为仅 embedding 检索结果）
- [ ] 4.4 运行 `pnpm lint` + `pnpm typecheck` 验证

## 5. 记忆检索工具（recall-memory）

- [ ] 5.1 新增 `server/tools/recall-memory.ts`，用 `tool()` 定义，参数：`query`（查询文本）；遵循 AGENTS.md 工具设计原则（职责单一、错误返回不抛异常、description 说明何时调用/不调用）
- [ ] 5.2 实现 embedding 检索逻辑：query 转向量 → 使用 Drizzle 原生 `cosineDistance()` 转换为相似度 `sql<number>\`1 - (${cosineDistance(...)})\`` + `desc(similarity)` 排序取 top-20（参照 Drizzle 官方文档推荐写法，详见 design.md 决策 1 第 4 点）
- [ ] 5.3 实现重排序精排：调用 reranker（传 `return_documents: true`，top_n=5）对 top-20 精排；过滤 reranker `relevance_score < 0.3` 的结果；reranker 失败降级取 embedding top-5，score 使用 `1 - distance/2` 映射
- [ ] 5.4 返回结果包含 `score` 字段（reranker 分数或余弦距离映射值，0-1 范围，1=最相关）；每条记忆包含 `content`、`message_id`、`session_id`、`role`、`score`
- [ ] 5.5 实现空结果处理（返回 `{ memories: [], message: "未找到相关历史记忆" }`）
- [ ] 5.6 编写 `description` 说明「何时调用」（用户涉及过去会话内容、历史偏好、之前讨论过的技术决策时）和「何时不调用」（当前会话内容、纯知识问答、简单计算时）
- [ ] 5.7 在 `server/api/chat.post.ts` 中注入 recall-memory 工具使用规则到 system prompt（当 `caps.toolCalling` 为 true 时），参考 OCR 工具规则注入模式（chat.post.ts 第143-164行附近）
- [ ] 5.8 运行 `pnpm lint` + `pnpm typecheck` 验证

## 6. 重要度筛选入库（归档）

- [ ] 6.1 新增 `server/utils/memory-archive.ts`，实现重要度判断逻辑：默认使用 `Qwen/Qwen3.5-4B`，**复用项目现有 `createReasoningProvider()` + AI SDK v5 `generateText()`（非流式）**，通过 `llmProvider(modelId, { enableThinking: false })` 创建 provider（`enable_thinking: false` 由 customFetch 层注入，非请求体直接传），参数 `temperature: 0.1`、`maxTokens: 4096`，输出严格 JSON 数组判断每条消息重要度（详见 design.md 决策 5）
- [ ] 6.2 实现 30 秒超时（通过 `generateText` 的 `abortSignal` 参数传入 `AbortController`），超时则该次归档整体失败（记录日志）
- [ ] 6.3 实现 JSON 解析容错：若 LLM `result.text` 返回含 `<think>` 标签或格式错误，整体降级为不入库（避免污染记忆库）
- [ ] 6.4 实现入库逻辑：对 LLM 判断为重要的消息调用 embedding 服务 → 写入 `memory_vectors` 表（`created_at` 从 `messages.created_at` 复制，`archived_at` 用 `defaultNow()`）
- [ ] 6.5 实现重复归档守卫（以 `message_id` 为粒度：已存在记录的消息跳过，未存在的消息继续处理）
- [ ] 6.6 实现消息过滤（排除 `role='system'`、敏感信息正则匹配、content 长度 < 5 字符的空短消息；注意：messages 表中不存在独立的工具调用结果消息，无需过滤）
- [ ] 6.7 实现进程内并发锁（`Map<string, Promise<void>>`）：同一会话归档进行中时，重复请求直接返回不重复执行
- [ ] 6.8 实现失败容错（单条消息 embedding 失败跳过、不阻断其他消息；LLM 判断失败或超时则整体跳过该次归档，下次重试）
- [ ] 6.9 运行 `pnpm lint` + `pnpm typecheck` 验证

## 7. 归档 API

- [ ] 7.1 新增 `server/api/sessions/[id]/archive-memory.post.ts`，调用 `memory-archive.ts` 异步执行归档
- [ ] 7.2 实现参数校验（`id` 为标准 UUID v4 格式，否则返回 400；会话不存在返回 404）
- [ ] 7.3 集成进程内并发锁（复用 memory-archive.ts 中的锁或在 API 层实现）
- [ ] 7.4 实现消息级幂等响应（已存在的 `message_id` 直接跳过，不重复处理）
- [ ] 7.5 运行 `pnpm lint` + `pnpm typecheck` 验证
- [ ] 7.6 同步更新 `docs/API.md` 记录新接口

## 8. 工具注册与服务端兜底

- [ ] 8.1 在 `server/api/chat.post.ts` 的 `toolsConfig` 注册 `recallMemoryTool`（条件：`caps.toolCalling` 为 true）
- [ ] 8.2 在 `server/api/chat.post.ts` 中，从请求 body 读取 `lastSessionId` 字段（前端传入的上一个会话 ID）
- [ ] 8.3 在 `onFinish` 回调中加入服务端归档兜底：若 `lastSessionId` 存在且不等于当前 `sessionId`，则**fire-and-forget** 触发该会话归档（启动 Promise 但**不 await 完成**，`.catch(console.error)` 兜底，不阻塞 `onFinish` 返回和流结束信号）；不引入全局会话缓存，保持服务端无状态
- [ ] 8.4 验证 `maxSteps` 动态计算正确（`hasActiveTools` 包含 recall-memory）
- [ ] 8.5 运行 `pnpm lint` + `pnpm typecheck` 验证

## 9. 前端触发归档

- [ ] 9.1 在 `composables/useChatSession.ts` 的 `switchSession()` 和 `createNewSession()` 方法中，**在修改 `currentSessionId.value` 之前**先保存旧值 `const previousSessionId = currentSessionId.value`，对**非空**的 `previousSessionId` fire-and-forget 调用 `POST /api/sessions/:id/archive-memory`（不 await 完成，`.catch(console.error)` 兜底，不阻塞切换）；首次加载 `currentSessionId` 为空字符串时不触发归档
- [ ] 9.2 维护 `lastSessionId` ref（在会话切换时更新为 `previousSessionId`），在 `useChat` 的 `body` computed 中传入 `/api/chat` 请求（遵循 AGENTS.md「useChat body 必须用 computed 包裹」规则）
- [ ] 9.3 实现静默失败（归档失败不弹 toast、不阻断切换，仅 console.error）
- [ ] 9.4 实现前端防重复守卫（同一会话归档请求进行中不重复调用）
- [ ] 9.5 运行 `pnpm lint` + `pnpm typecheck` 验证

## 10. 前端 ToolInvocation 展示

- [ ] 10.1 在 `components/chat/ToolInvocation.vue` 中新增 `recall-memory` 工具展示分支
- [ ] 10.2 实现检索中状态（"正在回忆历史记忆…"spinner）
- [ ] 10.3 实现检索完成状态（"已检索 X 条相关记忆"）
- [ ] 10.4 实现无结果状态（"未找到相关历史记忆"）
- [ ] 10.5 运行 `pnpm lint` + `pnpm typecheck` 验证

## 11. 测试

- [ ] 11.1 新增 `tests/unit/embedding.test.ts`，测试 embedding 服务（成功返回1024维、超长文本不截断仅警告日志、失败降级返回 {error}、runtimeConfig 读取）
- [ ] 11.2 新增 `tests/unit/reranker.test.ts`，测试 reranker 服务（成功精排、return_documents 参数、relevance_score 解析、失败降级返回 null）
- [ ] 11.3 新增 `tests/unit/recall-memory.test.ts`，测试检索工具（cosineDistance 余弦距离检索 top-20、重排序精排 top-5、score 字段、空结果、reranker 降级 score 映射、阈值过滤 0.3、description 完整性）
- [ ] 11.4 新增 `tests/unit/memory-archive.test.ts`，测试归档逻辑（`createReasoningProvider` + `generateText` + `{ enableThinking: false }` LLM 调用、重要度 JSON 解析、思考标签容错、消息级重复守卫、进程内并发锁、失败容错超时、角色/敏感信息过滤、`created_at` 从 messages 复制 / `archived_at` defaultNow 写入）
- [ ] 11.5 新增 `tests/api/archive-memory.test.ts`，测试归档 API（UUID 格式校验、404、消息级幂等、并发锁）
- [ ] 11.6 新增 `tests/e2e/recall-memory.e2e.test.ts`，测试 recall-memory 完整链路；LLM 自主调用 case 作为可选冒烟测试，核心链路通过直接调用 API/工具覆盖
- [ ] 11.7 运行 `pnpm test:unit` + `pnpm test:api` 验证全部通过
- [ ] 11.8 运行 `pnpm test:all` 验证不影响现有测试
