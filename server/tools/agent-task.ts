import { tool } from 'ai'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { agentTasks, agentTaskSteps, artifacts } from '~/server/db/schema'

/**
 * Agent 任务系统工具（openspec/changes/add-agent-task-system）
 *
 * 设计要点（design.md 决策 1、2、4、5）：
 *   - 是否规划、何时推进步骤全由 LLM 自主决策（Agent 路径，非 Workflow 预编排）
 *   - 工厂函数按请求绑定 sessionId：AI SDK 工具拿不到 HTTP 事件，
 *     sessionId 由已通过归属校验的 chat.post.ts 请求作用域闭包携带
 *   - 错误统一返回 { error, detail } 不抛异常，由 LLM 决定纠正策略
 *   - 步骤结果超长落 artifacts 表，消息与步骤只存摘要 + 引用（大对象按引用传递）
 */

/** 步骤数上限（防 LLM 生成病态大计划） */
const MAX_STEPS = 20

/** 步骤结果落工件的阈值（字符） */
const ARTIFACT_THRESHOLD = 2000

/** 步骤结果摘要长度（字符） */
const RESULT_SUMMARY_LEN = 200

/** 合法的任务状态与步骤状态（决策 5 状态机） */
const TASK_STATUSES = ['in_progress', 'completed', 'failed'] as const
type TaskStatus = (typeof TASK_STATUSES)[number]

const STEP_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const
type StepStatus = (typeof STEP_STATUSES)[number]

/** 合法迁移表：from → 允许的 to 集合（failed → in_progress 允许重试） */
const STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['completed', 'failed'],
  completed: [],
  failed: ['in_progress']
}

/** 归属守卫：taskId 必须属于本 session（跨会话引用按 404 语义拒绝） */
async function ensureTaskOwned(
  taskId: string,
  sessionId: string
): Promise<{ id: string; status: string; title: string } | null> {
  const rows = await db
    .select({ id: agentTasks.id, status: agentTasks.status, title: agentTasks.title })
    .from(agentTasks)
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.sessionId, sessionId)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * 创建 plan 工具实例（按请求绑定 sessionId）
 *
 * LLM 调用后：插入任务 + 步骤（pending），返回任务概要让 LLM 逐步执行
 */
export function createPlanTool(sessionId: string) {
  return tool({
    description:
      '创建结构化执行计划（plan→execute→reflect 的 plan 阶段）。当用户请求是明确的多步骤任务（需要按顺序执行多项操作、产出多份结果）时调用，把你的执行计划拆为有序步骤。不要在以下场景调用：简单问答、单步可完成的请求、闲聊（无计划价值，直接回答即可）。调用后你必须逐步执行各步骤，并用 updateTaskStep 推进状态。',
    inputSchema: z.object({
      title: z.string().min(1).max(200).describe('任务标题，简洁概括目标，如「调研三款开源 LLM 网关并对比」'),
      steps: z
        .array(z.string().min(1).max(500))
        .min(1)
        .max(MAX_STEPS)
        .describe('按执行顺序排列的步骤列表，每步一句可验证的描述')
    }),
    execute: async ({ title, steps }) => {
      try {
        const taskId = crypto.randomUUID()
        await db.insert(agentTasks).values({ id: taskId, sessionId, title, status: 'in_progress' })
        await db.insert(agentTaskSteps).values(
          steps.map((content, i) => ({
            id: crypto.randomUUID(),
            taskId,
            idx: i + 1,
            content,
            status: 'pending' as const
          }))
        )
        return {
          taskId,
          title,
          status: 'in_progress',
          steps: steps.map((content, i) => ({ idx: i + 1, content, status: 'pending' })),
          notice: `计划已创建（${steps.length} 步）。请逐步执行，每步完成后调用 updateTaskStep 更新该步骤状态并记录结果。`
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return { error: '创建计划失败', detail }
      }
    }
  })
}

/**
 * 创建 updateTaskStep 工具实例（按请求绑定 sessionId）
 *
 * 推进步骤状态（状态机校验）+ 记录结果摘要；超长结果自动落 artifacts 并返回引用
 */
export function createUpdateTaskStepTool(sessionId: string) {
  return tool({
    description:
      '更新任务步骤的执行状态与结果（plan→execute→reflect 的 execute/reflect 阶段）。每完成或失败一个步骤就调用一次：status 用 in_progress（开始执行）/ completed（成功，附 result 摘要）/ failed（失败，附原因）。必须携带 plan 工具返回的 taskId。不要对不存在或非本会话的任务调用；不要跳过状态机（pending 不能直接置 completed）。',
    inputSchema: z.object({
      taskId: z.string().min(1).describe('plan 工具返回的任务 ID'),
      stepIdx: z.number().int().min(1).describe('步骤序号（从 1 开始）'),
      status: z.enum(['in_progress', 'completed', 'failed']).describe('目标状态'),
      result: z.string().max(20000).optional().describe('执行结果（completed/failed 时应提供；超长内容会自动存为工件，步骤只保留摘要与引用）')
    }),
    execute: async ({ taskId, stepIdx, status, result }) => {
      try {
        const task = await ensureTaskOwned(taskId, sessionId)
        if (!task) {
          return { error: '任务不存在', detail: 'taskId 不存在或不属于当前会话' }
        }
        if (!TASK_STATUSES.includes(task.status as TaskStatus)) {
          return { error: '任务状态异常', detail: `任务当前状态 ${task.status}，无法更新步骤` }
        }

        const stepRows = await db
          .select()
          .from(agentTaskSteps)
          .where(and(eq(agentTaskSteps.taskId, taskId), eq(agentTaskSteps.idx, stepIdx)))
          .limit(1)
        const step = stepRows[0]
        if (!step) {
          return {
            error: '步骤不存在',
            detail: `步骤 ${stepIdx} 不存在，请核对 plan 返回的步骤列表后再试`
          }
        }

        const from = step.status as StepStatus
        const to = status as StepStatus
        if (!STEP_TRANSITIONS[from]?.includes(to)) {
          return {
            error: '非法状态迁移',
            detail: `步骤 ${stepIdx} 当前为 ${from}，不允许迁移到 ${to}（合法迁移：${(STEP_TRANSITIONS[from] || []).join('、') || '无'}）`
          }
        }

        // 工件持久化：结果超阈值 → 完整内容落 artifacts，步骤存摘要 + 引用
        let artifactId: string | undefined
        if (result && result.length > ARTIFACT_THRESHOLD) {
          artifactId = crypto.randomUUID()
          await db.insert(artifacts).values({
            id: artifactId,
            taskId,
            stepId: step.id,
            content: result
          })
        }
        const summary = result
          ? result.length > RESULT_SUMMARY_LEN
            ? result.slice(0, RESULT_SUMMARY_LEN) + '…'
            : result
          : undefined

        await db
          .update(agentTaskSteps)
          .set({ status: to, result: summary, updatedAt: new Date() })
          .where(eq(agentTaskSteps.id, step.id))

        // 全部步骤终态 → 任务收敛；否则维持 in_progress
        const allSteps = await db
          .select({ idx: agentTaskSteps.idx, status: agentTaskSteps.status })
          .from(agentTaskSteps)
          .where(eq(agentTaskSteps.taskId, taskId))
          .orderBy(asc(agentTaskSteps.idx))
        const terminal = allSteps.every((s) => s.status === 'completed' || s.status === 'failed')
        const anyFailed = allSteps.some((s) => s.status === 'failed')
        const taskStatus: TaskStatus = terminal ? (anyFailed ? 'failed' : 'completed') : 'in_progress'
        if (taskStatus !== task.status) {
          await db
            .update(agentTasks)
            .set({ status: taskStatus, updatedAt: new Date() })
            .where(eq(agentTasks.id, taskId))
        }

        return {
          taskId,
          stepIdx,
          stepStatus: to,
          taskStatus,
          ...(artifactId && { artifactId, notice: '完整结果已存为工件，步骤仅保留摘要' }),
          progress: `${allSteps.filter((s) => s.status === 'completed').length}/${allSteps.length} 步完成`
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return { error: '更新步骤失败', detail }
      }
    }
  })
}

/**
 * 查询会话进行中的任务（检查点注入用，design.md 决策 6）
 *
 * @returns 供 system prompt 注入的格式化文本；无进行中任务返回空串
 */
export async function getActiveTaskContext(sessionId: string): Promise<string> {
  try {
    const tasks = await db
      .select({ id: agentTasks.id, title: agentTasks.title, status: agentTasks.status })
      .from(agentTasks)
      .where(and(eq(agentTasks.sessionId, sessionId), eq(agentTasks.status, 'in_progress')))
      .limit(3)

    if (tasks.length === 0) return ''

    const blocks: string[] = []
    for (const task of tasks) {
      const steps = await db
        .select({ idx: agentTaskSteps.idx, content: agentTaskSteps.content, status: agentTaskSteps.status })
        .from(agentTaskSteps)
        .where(eq(agentTaskSteps.taskId, task.id))
        .orderBy(asc(agentTaskSteps.idx))
      const lines = steps
        .map((s) => `  ${s.idx}. [${s.status}] ${s.content}`)
        .join('\n')
      blocks.push(`- ${task.title}（taskId=${task.id}，status=${task.status}）\n${lines}`)
    }
    const text = blocks.join('\n')
    // 注入上限 2000 字符：超出截断（防病态大任务撑爆 prompt）
    return text.length > 2000 ? text.slice(0, 2000) + '…' : text
  } catch {
    // 查询失败不影响主流程：检查点注入是增强能力
    return ''
  }
}
