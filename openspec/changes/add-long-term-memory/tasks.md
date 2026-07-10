## 1. 数据库基础设施

- [ ] 1.1 在 PostgreSQL 启用 pgvector 扩展（`CREATE EXTENSION IF NOT EXISTS vector`），验证扩展可用
- [ ] 1.2 修改 `server/db/schema.ts` 新增 `memory_vectors` 表（字段：`id`、`message_id` 外键级联删除、`session_id` 外键级联删除、`content`、`embedding` vector(1024)、`role`、`created_at`）
- [ ] 1.3 运行 `pnpm db:push` 同步 schema 到数据库，验证表创建成功
- [ ] 1.4 同步更新 `docs/db-schema.md` 记录 `memory_vectors` 表结构

## 2. Embedding 服务

- [ ] 2.1 新增 `server/utils/embedding.ts`，封装硅基流动 `BAAI/bge-m3` 调用（复用 `OPENAI_API_KEY`），返回 1024 维向量
- [ ] 2.2 实现长文本截断处理（超 8K token 截断 + 警告日志）
- [ ] 2.3 实现 API 失败降级（返回 `{ error, detail }` 不抛异常）
- [ ] 2.4 运行 `pnpm lint` + `pnpm typecheck` 验证

## 3. 重排序服务

- [ ] 3.1 新增 `server/utils/reranker.ts`，封装硅基流动 `BAAI/bge-reranker-v2-m3` 调用，接收 query + documents 返回精排结果
- [ ] 3.2 实现 API 失败降级（返回 null，调用方降级为仅 embedding 检索结果）
- [ ] 3.3 运行 `pnpm lint` + `pnpm typecheck` 验证

## 4. 记忆检索工具（recall-memory）

- [ ] 4.1 新增 `server/tools/recall-memory.ts`，用 `tool()` 定义，参数：`query`（查询文本）
- [ ] 4.2 实现 embedding 检索逻辑：query 转向量 → `memory_vectors` 表余弦相似度检索 top-20
- [ ] 4.3 实现重排序精排：调用 reranker 对 top-20 精排，取 top-5（reranker 失败降级取 embedding top-5）
- [ ] 4.4 实现空结果处理（返回 `{ memories: [], message: "未找到相关历史记忆" }`）
- [ ] 4.5 编写 `description` 说明「何时调用」（用户涉及过去会话内容时）和「何时不调用」（当前会话内容、无关问题时）
- [ ] 4.6 运行 `pnpm lint` + `pnpm typecheck` 验证

## 5. 重要度筛选入库（归档）

- [ ] 5.1 新增 `server/utils/memory-archive.ts`，实现重要度判断逻辑：用轻量 LLM 判断会话内消息重要度
- [ ] 5.2 实现入库逻辑：对重要消息调用 embedding 服务 → 写入 `memory_vectors` 表
- [ ] 5.3 实现重复归档守卫（检查该会话是否已有记忆记录，已归档则跳过）
- [ ] 5.4 实现失败容错（单条消息 embedding 失败跳过、不阻断其他消息）
- [ ] 5.5 运行 `pnpm lint` + `pnpm typecheck` 验证

## 6. 归档 API

- [ ] 6.1 新增 `server/api/sessions/[id]/archive-memory.post.ts`，调用 `memory-archive.ts` 异步执行归档
- [ ] 6.2 实现参数校验（`id` 非空字符串校验、会话不存在返回 404）
- [ ] 6.3 实现幂等响应（已归档返回成功不重复处理）
- [ ] 6.4 运行 `pnpm lint` + `pnpm typecheck` 验证
- [ ] 6.5 同步更新 `docs/API.md` 记录新接口

## 7. 工具注册

- [ ] 7.1 在 `server/api/chat.post.ts` 的 `toolsConfig` 注册 `recallMemoryTool`（条件：`caps.toolCalling` 为 true）
- [ ] 7.2 验证 `maxSteps` 动态计算正确（`hasActiveTools` 包含 recall-memory）
- [ ] 7.3 运行 `pnpm lint` + `pnpm typecheck` 验证

## 8. 前端触发归档

- [ ] 8.1 在 `composables/useChatSession.ts` 的会话切换逻辑中，对上一个会话异步调用 `POST /api/sessions/:id/archive-memory`
- [ ] 8.2 实现静默失败（归档失败不弹 toast、不阻断切换，仅 console.error）
- [ ] 8.3 实现防重复提交守卫（同一会话归档进行中不重复调用）
- [ ] 8.4 运行 `pnpm lint` + `pnpm typecheck` 验证

## 9. 测试

- [ ] 9.1 新增 `tests/unit/embedding.test.ts`，测试 embedding 服务（成功、截断、失败降级）
- [ ] 9.2 新增 `tests/unit/recall-memory.test.ts`，测试检索工具（召回、重排序、空结果、降级）
- [ ] 9.3 新增 `tests/unit/memory-archive.test.ts`，测试归档逻辑（重要度筛选、重复守卫、失败容错）
- [ ] 9.4 新增 `tests/api/archive-memory.test.ts`，测试归档 API（参数校验、404、幂等）
- [ ] 9.5 运行 `pnpm test:unit` + `pnpm test:api` 验证全部通过
- [ ] 9.6 运行 `pnpm test:all` 验证不影响现有测试
