/**
 * Agent 任务工具单元测试（server/tools/agent-task.ts）
 *
 * Mock 策略：mock ~/server/db 模块（参考 tests/api/archive-memory.test.ts 模式），
 * select 构建器按调用顺序消费 limit/orderBy 队列。
 *
 * 覆盖：
 * - plan：成功创建（任务+步骤插入）、schema 校验（空步骤/超 20 步拒绝）
 * - updateTaskStep：合法状态迁移、非法迁移拒绝、跨会话 taskId 拒绝、
 *   超长结果落 artifacts + 摘要截断、全部终态后任务收敛（completed/failed）
 * - getActiveTaskContext：进行中任务格式化 + 无任务返回空串
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('~/server/db', () => ({ db: dbMock }))

// 动态导入被测模块（在 mock 之后）
const { createPlanTool, createUpdateTaskStepTool, getActiveTaskContext } = await import(
  '~/server/tools/agent-task'
)

/** select 构建器 mock：limit 按队列出队、orderBy 按队列出队 */
function mockSelect(limitQueue: unknown[][] = [], orderQueue: unknown[][] = []) {
  const builder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(limitQueue.length ? limitQueue.shift() : [])),
    orderBy: vi.fn().mockImplementation(() => Promise.resolve(orderQueue.length ? orderQueue.shift() : []))
  }
  dbMock.select.mockReset()
  dbMock.select.mockReturnValue(builder)
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.insert.mockReset()
  dbMock.update.mockReset()
})

describe('plan 工具', () => {
  const sessionId = 'sess-1'
  const planTool = createPlanTool(sessionId)

  it('schema 校验：空步骤列表拒绝', () => {
    const result = (planTool.inputSchema as any).safeParse({ title: 't', steps: [] })
    expect(result.success).toBe(false)
  })

  it('schema 校验：超过 20 步拒绝', () => {
    const result = (planTool.inputSchema as any).safeParse({
      title: 't',
      steps: Array.from({ length: 21 }, (_, i) => `步骤${i + 1}`)
    })
    expect(result.success).toBe(false)
  })

  it('成功创建任务与步骤，返回 taskId 与 pending 步骤', async () => {
    const values = vi.fn().mockResolvedValue(undefined)
    dbMock.insert.mockReturnValue({ values })

    const result = (await planTool.execute!(
      { title: '调研任务', steps: ['收集资料', '对比分析'] },
      { messages: [], toolCallId: 't1' }
    )) as any

    expect(result).toHaveProperty('taskId')
    expect(result.status).toBe('in_progress')
    expect(result.steps).toEqual([
      { idx: 1, content: '收集资料', status: 'pending' },
      { idx: 2, content: '对比分析', status: 'pending' }
    ])
    // 两次 insert：任务 + 步骤
    expect(values).toHaveBeenCalledTimes(2)
  })

  it('DB 异常返回错误对象（不抛异常）', async () => {
    dbMock.insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error('connection refused'))
    })
    const result = (await planTool.execute!(
      { title: 't', steps: ['a'] },
      { messages: [], toolCallId: 't1' }
    )) as any
    expect(result).toHaveProperty('error', '创建计划失败')
    expect(result.detail).toContain('connection refused')
  })
})

describe('updateTaskStep 工具', () => {
  const sessionId = 'sess-1'
  const updateTool = createUpdateTaskStepTool(sessionId)

  function mockOwnedTask(task: Record<string, string> | null) {
    // 第 1 次 select：ensureTaskOwned；第 2 次：步骤行；第 3 次：全部步骤（orderBy）
    mockSelect([task ? [task] : []], [])
  }

  it('taskId 跨会话/不存在 → 返回错误对象', async () => {
    mockOwnedTask(null)
    const result = (await updateTool.execute!(
      { taskId: 't1', stepIdx: 1, status: 'in_progress' },
      { messages: [], toolCallId: 't1' }
    )) as any
    expect(result).toHaveProperty('error', '任务不存在')
  })

  it('pending → in_progress 合法迁移，返回进行中任务状态', async () => {
    // ensureTaskOwned → task；步骤 select → step；orderBy → 全部步骤
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'task-1', status: 'in_progress', title: 't' }])
        )
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'step-1', idx: 1, status: 'pending', content: 'a' }])
        ),
      orderBy: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve([
            { idx: 1, status: 'in_progress' },
            { idx: 2, status: 'pending' }
          ])
        )
    }
    dbMock.select.mockReturnValue(builder)
    const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    dbMock.update.mockReturnValue({ set: setFn })

    const result = (await updateTool.execute!(
      { taskId: 'task-1', stepIdx: 1, status: 'in_progress' },
      { messages: [], toolCallId: 't1' }
    )) as any

    expect(result.stepStatus).toBe('in_progress')
    expect(result.taskStatus).toBe('in_progress')
    expect(result.progress).toBe('0/2 步完成')
  })

  it('pending → completed 非法迁移 → 返回错误（不抛异常）', async () => {
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'task-1', status: 'in_progress', title: 't' }])
        )
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'step-1', idx: 1, status: 'pending', content: 'a' }])
        ),
      orderBy: vi.fn().mockResolvedValue([])
    }
    dbMock.select.mockReturnValue(builder)

    const result = (await updateTool.execute!(
      { taskId: 'task-1', stepIdx: 1, status: 'completed', result: 'x' },
      { messages: [], toolCallId: 't1' }
    )) as any
    expect(result).toHaveProperty('error', '非法状态迁移')
  })

  it('超长结果自动落 artifacts，步骤仅存摘要并返回 artifactId', async () => {
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'task-1', status: 'in_progress', title: 't' }])
        )
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'step-1', idx: 1, status: 'in_progress', content: 'a' }])
        ),
      orderBy: vi
        .fn()
        .mockResolvedValue([{ idx: 1, status: 'completed' }])
    }
    dbMock.select.mockReturnValue(builder)
    const insertValues = vi.fn().mockResolvedValue(undefined)
    dbMock.insert.mockReturnValue({ values: insertValues })
    const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    dbMock.update.mockReturnValue({ set: setFn })

    const longResult = 'x'.repeat(3000)
    const result = (await updateTool.execute!(
      { taskId: 'task-1', stepIdx: 1, status: 'completed', result: longResult },
      { messages: [], toolCallId: 't1' }
    )) as any

    expect(result.artifactId).toBeTruthy()
    // 一次 insert：工件
    expect(insertValues).toHaveBeenCalledTimes(1)
    // 摘要 = 200 字符 + 省略号
    const savedStep = setFn.mock.calls[0][0]
    expect(savedStep.result.length).toBe(201)
    expect(savedStep.result.endsWith('…')).toBe(true)
    expect(result.taskStatus).toBe('completed')
  })

  it('全部步骤终态且存在 failed → 任务收敛为 failed', async () => {
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'task-1', status: 'in_progress', title: 't' }])
        )
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'step-2', idx: 2, status: 'in_progress', content: 'b' }])
        ),
      orderBy: vi
        .fn()
        .mockResolvedValue([
          { idx: 1, status: 'completed' },
          { idx: 2, status: 'failed' }
        ])
    }
    dbMock.select.mockReturnValue(builder)
    dbMock.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    const result = (await updateTool.execute!(
      { taskId: 'task-1', stepIdx: 2, status: 'failed', result: '上游超时' },
      { messages: [], toolCallId: 't1' }
    )) as any
    expect(result.taskStatus).toBe('failed')
  })

  it('failed → in_progress 允许重试', async () => {
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'task-1', status: 'failed', title: 't' }])
        )
        .mockImplementationOnce(() =>
          Promise.resolve([{ id: 'step-2', idx: 2, status: 'failed', content: 'b' }])
        ),
      orderBy: vi.fn().mockResolvedValue([{ idx: 2, status: 'in_progress' }])
    }
    dbMock.select.mockReturnValue(builder)
    dbMock.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    const result = (await updateTool.execute!(
      { taskId: 'task-1', stepIdx: 2, status: 'in_progress' },
      { messages: [], toolCallId: 't1' }
    )) as any
    expect(result.stepStatus).toBe('in_progress')
  })
})

describe('getActiveTaskContext（检查点注入）', () => {
  it('无进行中任务返回空串', async () => {
    mockSelect([[]])
    const text = await getActiveTaskContext('sess-1')
    expect(text).toBe('')
  })

  it('有进行中任务时返回含步骤状态的格式化文本', async () => {
    const builder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'task-1', title: '调研任务' }])
        .mockResolvedValue([]),
      orderBy: vi
        .fn()
        .mockResolvedValueOnce([
          { idx: 1, content: '收集资料', status: 'completed' },
          { idx: 2, content: '对比分析', status: 'pending' }
        ])
    }
    dbMock.select.mockReturnValue(builder)

    const text = await getActiveTaskContext('sess-1')
    expect(text).toContain('调研任务')
    expect(text).toContain('[completed] 收集资料')
    expect(text).toContain('[pending] 对比分析')
  })
})
