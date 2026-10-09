/**
 * 对话轮次持久化测试
 *
 * 覆盖 Bug #1（「重新生成」导致消息重复入库）的修复语义：
 *   - 常规发送：插入最后一条用户消息 + AI 回复
 *   - 重新生成：不重复插入用户消息，改为更新既有助手回复行
 *   - 误伤防护：上一轮回复未落库时，不得覆盖更早一轮的历史回复
 *
 * 策略：mock ~/server/db 模块（与 tests/api/sessions.test.ts 一致），避免真实数据库连接
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockDb,
  mockMessages,
  mockSessions,
  selectQueue,
  deleteWhere,
  executedSql
} = vi.hoisted(() => {
  /** 列 mock：仅需让 drizzle 操作符拿到对象即可，不校验生成的 SQL */
  const col = (name: string) => ({ name, table: {}, dataType: 'string' })

  const mockMessages = {
    id: col('id'),
    sessionId: col('session_id'),
    role: col('role'),
    content: col('content'),
    metadata: col('metadata'),
    createdAt: col('created_at')
  }
  const mockSessions = { id: col('id'), updatedAt: col('updated_at') }

  const selectQueue: unknown[][] = []

  /** 可 await 的 select 链：from/where/orderBy 均返回自身，limit 返回预设行 */
  const selectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => Promise.resolve(rows)
    return chain
  }

  const select = vi.fn(() => selectChain(selectQueue.shift() ?? []))

  /** 记录 DELETE 的 where 条件，供断言裁剪范围 */
  const deleteWhere: unknown[][] = []
  const deleteChain = {
    where: vi.fn((cond: unknown) => {
      deleteWhere.push([cond])
      return Promise.resolve()
    })
  }

  /** 记录事务内执行的裸 SQL（用于断言会话级 advisory lock 已获取） */
  const executedSql: unknown[][] = []

  const mockDb = {
    select,
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    delete: vi.fn(() => deleteChain),
    execute: vi.fn((statement: unknown) => {
      executedSql.push([statement])
      return Promise.resolve()
    }),
    // 真实实现里 persistChatTurn 整体跑在事务中；mock 直接把同一个句柄交给回调
    transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockDb))
  }

  return { mockDb, mockMessages, mockSessions, selectQueue, deleteWhere, executedSql }
})

vi.mock('~/server/db', () => ({ db: mockDb }))
vi.mock('~/server/db/schema', () => ({ messages: mockMessages, sessions: mockSessions }))

import { persistChatTurn } from '~/server/utils/message-persistence'

/** 取某次 insert 的落库值 */
function insertedValues(call = 0) {
  return (mockDb.insert.mock.results[call]?.value as { values: { mock: { calls: unknown[][] } } })
    .values.mock.calls[0][0] as Record<string, any>
}

/** 取 update 的 set 参数 */
function updatedSet(call = 0) {
  const updateResult = mockDb.update.mock.results[call]?.value as {
    set: { mock: { calls: unknown[][] } }
  }
  return updateResult.set.mock.calls[0][0] as Record<string, any>
}

/** 把 drizzle sql 模板的片段拼成可读文本（queryChunks 混合字面量与参数值） */
function sqlText(statement: unknown): string {
  const chunks = (statement as { queryChunks?: unknown[] })?.queryChunks ?? []
  return chunks
    .map((c) => (typeof c === 'string' ? c : String((c as { value?: unknown }).value ?? '')))
    .join('')
}

describe('persistChatTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    deleteWhere.length = 0
    executedSql.length = 0
  })

  it('写入应在会话级 advisory lock 之后、同一事务内执行', async () => {
    await persistChatTurn({
      sessionId: 's-lock',
      userText: '你好',
      assistantText: '回答',
      modelName: 'Qwen3-8B'
    })

    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(mockDb.execute).toHaveBeenCalledTimes(1)

    const text = sqlText(executedSql[0][0])
    expect(text).toContain('pg_advisory_xact_lock')
    expect(text).toContain('s-lock')

    // 先取锁再写：否则并发裁剪仍会互相删掉对方刚插入的行
    expect(mockDb.execute.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.insert.mock.invocationCallOrder[0]
    )
  })

  it('常规发送应插入用户消息与助手回复，并更新会话 updatedAt', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: '你好',
      assistantText: '你好，有什么可以帮你？',
      modelName: 'Qwen3-8B'
    })

    expect(mockDb.insert).toHaveBeenCalledTimes(2)
    expect(insertedValues(0)).toMatchObject({ sessionId: 's1', role: 'user', content: '你好' })
    expect(insertedValues(1)).toMatchObject({
      sessionId: 's1',
      role: 'assistant',
      content: '你好，有什么可以帮你？',
      metadata: { model: 'Qwen3-8B' }
    })
    // 会话 updatedAt 更新一次
    expect(mockDb.update).toHaveBeenCalledTimes(1)
  })

  it('常规发送应把图片与语音元信息写入用户消息 metadata', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: '看这张图',
      assistantText: '好的',
      modelName: 'Qwen3.5-4B',
      imageUrls: ['https://img/1.png'],
      audio: { url: '/audio/1.wav', emotion: 'happy', duration: 3 }
    })

    const userRow = insertedValues(0)
    expect(userRow.metadata.images).toEqual([{ index: 0, url: 'https://img/1.png' }])
    expect(userRow.metadata.audio).toMatchObject({ url: '/audio/1.wav', emotion: 'happy', duration: 3 })
  })

  it('重新生成：不插入用户消息，改为更新既有助手回复行', async () => {
    const userAt = new Date('2026-09-15T10:00:00.000Z')
    const assistantAt = new Date('2026-09-15T10:00:30.000Z')
    // 第 1 次 select 取最新助手行，第 2 次取最新用户行（助手晚于用户 → 属于本轮回复）
    selectQueue.push([{ id: 'a1', createdAt: assistantAt }])
    selectQueue.push([{ id: 'u1', createdAt: userAt }])

    await persistChatTurn({
      sessionId: 's1',
      userText: '你好',
      assistantText: '新的回答',
      modelName: 'Qwen3-8B',
      isRegenerate: true
    })

    // 用户消息不重复插入，助手回复不新增行
    expect(mockDb.insert).not.toHaveBeenCalled()
    // 既有助手行被更新为新内容
    const updateSet = updatedSet()
    expect(updateSet).toMatchObject({ content: '新的回答', metadata: { model: 'Qwen3-8B' } })
    // 第 2 次 update 是会话 updatedAt
    expect(mockDb.update).toHaveBeenCalledTimes(2)
  })

  it('重新生成但库中无助手回复时应插入新行（不报错、不丢回复）', async () => {
    selectQueue.push([])

    await persistChatTurn({
      sessionId: 's1',
      userText: '你好',
      assistantText: '首次落库的回答',
      modelName: 'Qwen3-8B',
      isRegenerate: true
    })

    expect(mockDb.insert).toHaveBeenCalledTimes(1)
    expect(insertedValues(0)).toMatchObject({ role: 'assistant', content: '首次落库的回答' })
  })

  it('重新生成时若最新助手行早于最新用户行（上轮回复未落库）应插入新行而非覆盖历史', async () => {
    selectQueue.push([{ id: 'a-old', createdAt: new Date('2026-09-15T09:00:00.000Z') }])
    selectQueue.push([{ id: 'u2', createdAt: new Date('2026-09-15T10:00:00.000Z') }])

    await persistChatTurn({
      sessionId: 's1',
      userText: '第二轮问题',
      assistantText: '第二轮回答',
      modelName: 'Qwen3-8B',
      isRegenerate: true
    })

    // 只插入助手回复（用户消息重新生成时不插入），且没有 update 覆盖历史行
    expect(mockDb.insert).toHaveBeenCalledTimes(1)
    expect(insertedValues(0)).toMatchObject({ role: 'assistant' })
    const updateSetCalls = mockDb.update.mock.calls.length
    expect(updateSetCalls).toBe(1) // 仅会话 updatedAt
  })

  it('助手回复为空时不落库助手消息，但仍保留用户消息与会话时间戳更新', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: '你好',
      assistantText: '   ',
      modelName: 'Qwen3-8B'
    })

    expect(mockDb.insert).toHaveBeenCalledTimes(1)
    expect(insertedValues(0)).toMatchObject({ role: 'user' })
  })

  it('重新生成且新回复为空时应保留既有助手回复（不删除、不新增）', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: '你好',
      assistantText: '',
      modelName: 'Qwen3-8B',
      isRegenerate: true
    })

    expect(mockDb.insert).not.toHaveBeenCalled()
    // 仅会话 updatedAt，助手行未被覆盖
    expect(mockDb.update).toHaveBeenCalledTimes(1)
  })

  it('无可保存的用户消息（userText 为 null）时只落库助手回复', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: null,
      assistantText: '回答',
      modelName: 'Qwen3-8B'
    })

    expect(mockDb.insert).toHaveBeenCalledTimes(1)
    expect(insertedValues(0)).toMatchObject({ role: 'assistant' })
  })

  it('sessionId 为空时不做任何写库操作', async () => {
    await persistChatTurn({
      sessionId: '',
      userText: '你好',
      assistantText: '回答',
      modelName: 'Qwen3-8B'
    })

    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(mockDb.update).not.toHaveBeenCalled()
    // 早退发生在开事务之前：空 sessionId 不该占用事务连接或抢锁
    expect(mockDb.transaction).not.toHaveBeenCalled()
    expect(mockDb.execute).not.toHaveBeenCalled()
  })

  it('编辑重发：先裁剪锚点及其后的历史，再按常规插入新一轮', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: '改后的问题',
      assistantText: '改后的回答',
      modelName: 'Qwen3-8B',
      pruneFromMessageId: 'u-edit'
    })

    expect(mockDb.delete).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveLength(1)
    // 裁剪发生在插入之前，否则会把刚写入的新一轮删掉
    const deleteOrder = mockDb.delete.mock.invocationCallOrder[0]
    const firstInsertOrder = mockDb.insert.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(firstInsertOrder)
    expect(mockDb.insert).toHaveBeenCalledTimes(2)
    expect(insertedValues(0)).toMatchObject({ role: 'user', content: '改后的问题' })
  })

  it('未传 pruneFromMessageId 时不应删除任何历史', async () => {
    await persistChatTurn({
      sessionId: 's1',
      userText: '你好',
      assistantText: '回答',
      modelName: 'Qwen3-8B'
    })

    expect(mockDb.delete).not.toHaveBeenCalled()
  })

  it('sessionId 为空时即便带裁剪 id 也不写库', async () => {
    await persistChatTurn({
      sessionId: '',
      userText: '你好',
      assistantText: '回答',
      modelName: 'Qwen3-8B',
      pruneFromMessageId: 'u-edit'
    })

    expect(mockDb.delete).not.toHaveBeenCalled()
  })
})
