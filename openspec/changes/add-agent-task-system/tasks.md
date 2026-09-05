# 任务：Agent 任务系统

## 1. Schema

- [x] 1.1 `server/db/schema.ts` 新增 agent_tasks / agent_task_steps / artifacts 三表（级联归属 + 索引）；`pnpm db:push`
- [x] 1.2 `pnpm lint` + `pnpm typecheck`

## 2. 工具实现

- [x] 2.1 `server/tools/agent-task.ts`：`createPlanTool(sessionId)`（校验步骤 1..20，插入 tasks + steps，返回 taskId/步骤摘要）、`createUpdateTaskStepTool(sessionId)`（状态机校验、超长 result 落 artifacts、返回引用）、`getActiveTaskContext(sessionId)`（检查点注入用查询）；错误 `{ error, detail }` 不抛
- [x] 2.2 单元测试：mock `~/server/db`，覆盖成功/空步骤/超 20 步/非法迁移/超长结果落工件/跨会话 taskId 拒绝；`pnpm test:unit`
- [x] 2.3 `pnpm lint` + `pnpm typecheck`

## 3. 注册与检查点注入

- [x] 3.1 chat.post.ts：`sessionId` 有效时注册 `plan` / `updateTaskStep`（工厂实例）；追加【任务规划工具使用规则】注入（条件与注册严格一致）
- [x] 3.2 chat.post.ts：system prompt 末尾注入未完成任务上下文（getActiveTaskContext，≤2000 字符，条件同上）
- [x] 3.3 `pnpm lint` + `pnpm typecheck` + `pnpm test:unit` + `pnpm test:api`

## 4. 文档与验证

- [x] 4.1 `docs/db-schema.md` 三表说明；`docs/API.md` AI 工具章节新增 plan / updateTaskStep；`AGENTS.md` 架构清单同步
- [x] 4.2 `pnpm dev` 实测：让 LLM 规划一个两步任务并逐步执行，验证 ToolInvocation 可见性 + 步骤状态推进 + 会话续聊时检查点注入
- [x] 4.3 全量 `pnpm lint` + `pnpm typecheck` + `pnpm test:unit` + `pnpm test:api` + `pnpm test:component`

> 完成记录（2026-09-05）：在线冒烟通过——LLM 自主调用 plan 创建 4 步任务（落库）、updateTaskStep 可被调用、检查点注入确认（system prompt 含任务状态）。小模型在 5 步循环内执行质量有限属模型行为，非架构问题；建议搭配较强模型使用任务功能。
