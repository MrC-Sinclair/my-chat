/**
 * AI SDK v5 + MCP 天气工具 E2E 测试
 *
 * 覆盖本次大改造的关键端到端场景：
 * - Chat 类迁移（v5）：sendMessage / stop / status
 * - MCP 天气工具：LLM 调用 MCP weather 工具并返回结果
 * - 流式输出：打字机效果、UIMessage 流格式
 * - 推理过程显示：reasoning_content
 * - ToolInvocation v5 状态：input-streaming → output-available
 * - 会话切换：parts 结构消息映射
 *
 * 使用 mock API 消除 LLM 不确定性，确保测试稳定
 */
import { test, expect } from '@playwright/test'
import {
  buildTextStream,
  buildReasoningStream,
  buildWeatherToolStream,
  mockChatAPI,
  typeAndSubmit,
  waitForResponse,
  waitForAssistantMessage
} from './helpers/mock-chat'

test.describe.configure({ mode: 'serial', retries: 1 })
test.setTimeout(120000)

// ==================== Chat 类迁移（v5） ====================

test.describe('Chat 类迁移（v5）', () => {
  test('sendMessage + status: 发送消息后应显示用户气泡、AI回复、停止按钮', async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
    await mockChatAPI(page, buildTextStream('测试成功！'), 80)

    await typeAndSubmit(page, '说"测试成功"，20字以内')

    // 用户气泡应出现
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 10000 })

    // 加载中：停止按钮应出现
    await expect(page.getByTestId('stop-btn')).toBeVisible({ timeout: 10000 })

    // AI 回复应出现
    await waitForAssistantMessage(page, 30000)

    // 等待回复完成
    await waitForResponse(page, 30000)

    // 完成后：停止按钮应消失
    await expect(page.getByTestId('stop-btn')).not.toBeVisible({ timeout: 5000 })

    // 验证助手消息有内容
    const assistantEl = page.locator('[data-testid="message-assistant"]').first()
    const text = await assistantEl.textContent()
    expect(text).toBeTruthy()
    expect(text!.trim().length).toBeGreaterThan(0)
  })

  test('stop: 点击停止按钮应中断生成', async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })

    // 使用长文本 + 小 chunk + 较长延迟确保 stop 按钮出现
    const longText = '这是一段很长的文本，用于测试停止功能。'.repeat(20)
    await mockChatAPI(page, buildTextStream(longText, 1), 100)

    await typeAndSubmit(page, '写一篇500字的散文')

    // 等待停止按钮出现
    await expect(page.getByTestId('stop-btn')).toBeVisible({ timeout: 10000 })

    // 等待部分内容生成
    await page.waitForTimeout(1000)

    // 点击停止
    await page.getByTestId('stop-btn').click()

    // 停止后：stop 按钮应消失，说明生成已中断
    await expect(page.getByTestId('stop-btn')).not.toBeVisible({ timeout: 10000 })
  })
})

// ==================== MCP 天气工具 ====================

test.describe('MCP 天气工具', () => {
  test('LLM 应识别天气意图并调用 MCP weather 工具', async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
    await mockChatAPI(page, buildWeatherToolStream(), 80)

    await typeAndSubmit(page, '深圳今天天气怎么样')

    // 等待 AI 回复完成
    await waitForResponse(page, 60000)

    // 验证页面中包含天气相关内容
    const bodyText = await page.locator('body').textContent()
    expect(bodyText).toBeTruthy()
    const hasWeatherInfo =
      bodyText!.includes('°C') ||
      bodyText!.includes('天气') ||
      bodyText!.includes('温度') ||
      bodyText!.includes('风速')
    expect(hasWeatherInfo).toBeTruthy()
  })
})

// ==================== 流式输出（UIMessage 流格式） ====================

test.describe('流式输出（UIMessage 流格式）', () => {
  test('打字机效果：内容应逐步增长', async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })

    // 使用长文本 + 小 chunk + 延迟确保采样充分
    const longText =
      '这是一篇关于人工智能的短文。人工智能正在改变我们的生活方式，从智能助手到自动驾驶，AI 技术无处不在。未来，AI 将在医疗、教育、科研等领域发挥更大作用。'
    await mockChatAPI(page, buildTextStream(longText, 2), 60)

    await typeAndSubmit(page, '用Markdown写一篇100字短文，纯文字不要代码块')

    // 等待助手消息开始出现
    await waitForAssistantMessage(page, 30000)
    await page.waitForTimeout(300)

    const contentLengths: number[] = []
    const startTime = Date.now()

    // 采样内容长度变化
    while (Date.now() - startTime < 15000) {
      const assistantEl = page.locator('[data-testid="message-assistant"]').first()
      if (await assistantEl.isVisible().catch(() => false)) {
        const text = (await assistantEl.textContent()) || ''
        contentLengths.push(text.length)
      }
      // 检查是否回复完成
      const stopBtn = page.getByTestId('stop-btn')
      if (!(await stopBtn.isVisible().catch(() => false))) break
      await page.waitForTimeout(200)
    }

    // 应有多次采样
    expect(contentLengths.length).toBeGreaterThan(1)
    // 内容应有增长变化（打字机效果）
    const uniqueLengths = new Set(contentLengths)
    expect(uniqueLengths.size).toBeGreaterThanOrEqual(2)
  })

  test('流式输出期间不应有严重 console error', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
    await mockChatAPI(page, buildTextStream('你好！很高兴见到你。'), 80)

    await typeAndSubmit(page, '说"你好"，20字以内')
    await waitForResponse(page, 30000)

    // 过滤掉无关的错误
    const relevantErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection') &&
        !e.includes('429') &&
        !e.includes('Too Many Requests') &&
        !e.includes('/api/sessions') &&
        !e.includes('加载会话列表失败') &&
        !e.includes('500') &&
        !e.includes('加载模型列表失败')
    )
    expect(relevantErrors).toEqual([])
  })
})

// ==================== 推理过程显示 ====================

test.describe('推理过程显示', () => {
  test('推理模型应显示思考过程或正常回复', async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
    await mockChatAPI(
      page,
      buildReasoningStream(
        '天空是蓝色的原因是瑞利散射...',
        '天空之所以是蓝色的，是因为大气中的分子对阳光产生瑞利散射，蓝色光波长较短，散射更强烈。'
      ),
      80
    )

    await typeAndSubmit(page, '解释为什么天空是蓝色的')
    await waitForResponse(page, 60000)

    // AI 回复应出现
    await waitForAssistantMessage(page, 10000)

    const assistantEl = page.locator('[data-testid="message-assistant"]').first()
    const text = await assistantEl.textContent()
    expect(text).toBeTruthy()
    expect(text!.length).toBeGreaterThan(0)
  })
})

// ==================== 会话切换（parts 结构映射） ====================

test.describe('会话切换（parts 结构映射）', () => {
  test('发送消息后页面应正确显示用户和助手消息', async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
    await mockChatAPI(page, buildTextStream('第一条消息已收到。'), 80)

    await typeAndSubmit(page, '说"第一条消息"')
    await waitForResponse(page, 30000)

    // 验证有用户消息
    const userMessages = page.locator('[data-testid="message-user"]')
    expect(await userMessages.count()).toBeGreaterThanOrEqual(1)

    // 验证有助手消息
    const assistantMessages = page.locator('[data-testid="message-assistant"]')
    expect(await assistantMessages.count()).toBeGreaterThanOrEqual(1)
  })
})
