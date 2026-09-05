# 设计：Agent 任务系统

## Goals

- 长程意图结构化落库，规划过程对用户可见
- 步骤执行状态可追踪，超长结果进工件表
- 会话中断后凭结构化状态继续

## Non-Goals

- 跨会话任务编排、定时/后台执行
- 进程级断点续跑（崩溃恢复）——检查点语义限于「对话继续时 LLM 可见任务状态」
- 任务看板等管理 UI（后续迭代）

## 关键决策

### 决策 1：工具 = LLM 自主决策（Agent 路径）

`plan`（创建任务+步骤）与 `updateTaskStep`（推进步骤状态/记录结果）为普通 `tool()`，注册条件 `caps.toolCalling`（与 recall-memory 一致，无前端开关）。调用与否、次数、顺序完全由 LLM 决定；禁止代码预编排。工具描述写明「何时调用/何时不调用」。

### 决策 2：工厂函数绑定 sessionId

AI SDK 工具 execute 拿不到 HTTP 事件。chat.post.ts 在已通过归属校验的请求作用域内用 `createPlanTool(sessionId)` 工厂创建实例，闭包携带 sessionId——归属信息不出请求边界。无 sessionId（异常旧客户端）时不注册。

### 决策 3：三表结构与归属

- `agent_tasks`：id PK、session_id FK(cascade)、title、status（`in_progress|completed|failed`）、created_at、updated_at
- `agent_task_steps`：id PK、task_id FK(cascade)、idx int、content、status（`pending|in_progress|completed|failed`）、result text（摘要）、updated_at；索引 (task_id)
- `artifacts`：id PK、task_id FK(cascade)、step_id、content、created_at

归属 = session 归属（用户已校验），不冗余 user_id。

### 决策 4：工件持久化阈值

`updateTaskStep` 的 result 超过 2000 字符：完整内容写 `artifacts`，`steps.result` 存前 200 字符 + `artifactId` 引用。返回给 LLM 的结构含 `artifactId`（大对象按引用传递，符合 AGENTS.md 工具规范）。

### 决策 5：步骤状态机与错误返回

`pending → in_progress → completed|failed`；`failed → in_progress` 允许重试。非法迁移返回 `{ error, detail }` 不抛异常，由 LLM 决定纠正（如先了解当前状态——提供 `getTaskStatus`? 不加：updateTaskStep 返回的错误信息附带当前状态即可，少一个工具）。

### 决策 6：检查点注入

chat.post.ts 查询该 session 的 `in_progress` 任务及其未完成步骤，注入 system prompt（截断 ≤2000 字符，格式化列表）。注入条件与工具注册一致（caps.toolCalling 且有任务）。LLM 看到状态后自主决定继续/询问/放弃。

### 决策 7：规划可见性

plan 调用与结果经现有 ToolInvocation 组件展示（任务标题 + 步骤列表），满足 roadmap「规划结果作为 reasoning 暴露给前端，不静默执行」。v1 不做专用 UI。

## API/错误处理

无新 HTTP 路由（纯工具路径）。工具错误统一 `{ error, detail }`：
- plan：空步骤列表 / 步骤数 >20 / DB 异常
- updateTaskStep：taskId 不属于本 session（404 语义）、非法状态迁移、步骤不存在
