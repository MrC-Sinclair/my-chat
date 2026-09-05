# 提案：Agent 任务系统（任务状态 + 显式规划 + 工件持久化 + 检查点恢复）

## Why

AGENTS.md「Agent 架构设计规范」远期路线（openspec/agent-future-roadmap.md）的四项演进：任务状态独立存储、显式任务规划（plan→execute→reflect）、工件持久化、检查点恢复。当前长程意图只存在于对话文本中，无结构化状态支撑。

## What Changes

- 新增 `agent_tasks` / `agent_task_steps` / `artifacts` 三张表（任务状态独立于 messages）
- 新增 `plan` 与 `updateTaskStep` 两个 Agent 工具：**是否规划、何时更新步骤全由 LLM 自主决策**（符合工具系统设计原则），规划结果经现有 ToolInvocation UI 对用户可见（不静默执行）
- 步骤结果超长时自动落 `artifacts` 表，消息/步骤只存摘要与引用（工件持久化）
- 会话继续时，chat.post.ts 将未完成任务状态注入 system prompt（检查点语义：LLM 基于结构化状态自主续作）

## Impact

| 层级 | 变更 |
| --- | --- |
| 数据库 | 新增 3 表（均经 session_id 级联归属）+ `pnpm db:push` |
| 服务端 | `server/tools/agent-task.ts`（工厂函数按请求绑定 sessionId）；chat.post.ts 注册工具 + 规则/检查点注入 |
| 前端 | 无新组件（复用 ToolInvocation 渲染工具调用） |
| 文档 | db-schema.md / API.md（工具章节）/ AGENTS.md 架构清单 |

## Capabilities

- New Capabilities: agent-task-system（规划/步骤/工件/检查点）

## 关键决策预告

1. 工具用工厂函数 `createPlanTool(sessionId)` 按请求创建：工具无事件上下文，sessionId 由已通过归属校验的请求闭包绑定
2. 检查点恢复 = 对话内恢复：未完成任务注入 prompt，LLM 自主续作；不做进程级断点续跑（超出对话 Agent 语义，见 Non-Goals）
3. 步骤状态机：`pending → in_progress → completed | failed`，仅允许合法迁移（非法更新返回 error 由 LLM 纠正）
