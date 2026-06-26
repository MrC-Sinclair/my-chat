/**
 * MarkdownRenderer 流式渲染性能 E2E 测试
 *
 * 在真实浏览器中验证流式渲染的增量更新行为。
 * 使用 mock API 确保测试稳定。
 */
import { test, expect } from '@playwright/test'
import {
  buildTextStream,
  buildCodeBlockStream,
  buildReasoningStream,
  mockChatAPI,
  typeAndSubmit
} from './helpers/mock-chat'

test.setTimeout(90000)

test.describe('流式渲染性能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  test('流式输出期间 .markdown-body 内容应逐步增长（验证打字机效果）', async ({ page }) => {
    // 使用长文本 + 小 chunk + 延迟确保采样充分
    const longText = '这是一篇关于人工智能的短文。人工智能正在改变我们的生活方式，从智能助手到自动驾驶，AI 技术无处不在。未来，AI 将在医疗、教育、科研等领域发挥更大作用。机器学习的进步让计算机能够从数据中学习，深度学习则推动了图像识别和自然语言处理的突破。'
    await mockChatAPI(page, buildTextStream(longText, 2), 60)

    await typeAndSubmit(page, '用Markdown写一篇100字短文，包含标题和列表，纯文字不要代码块')

    // 等待 markdown-body 出现且有实际内容
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.markdown-body')
        return el && (el.textContent || '').length > 10
      },
      { timeout: 30000 }
    )
    await page.waitForTimeout(300)

    const contentLengths: number[] = []
    const startTime = Date.now()

    while (Date.now() - startTime < 15000) {
      const markdownEl = page.locator('.markdown-body').first()
      if (await markdownEl.isVisible()) {
        const text = (await markdownEl.textContent()) || ''
        contentLengths.push(text.length)
      }
      if (await page.locator('button[data-testid="send-btn"]').isVisible()) break
      await page.waitForTimeout(200)
    }

    expect(contentLengths.length).toBeGreaterThan(1)

    // 降低阈值：mock 环境下内容可能很快到达
    const uniqueLengths = new Set(contentLengths)
    expect(uniqueLengths.size).toBeGreaterThanOrEqual(2)
  })

  test('含代码块的流式输出：代码块应正确渲染', async ({ page }) => {
    await mockChatAPI(page, buildCodeBlockStream(), 80)

    await typeAndSubmit(page, '用js写一个hello world，要有 ```js 代码块')

    await page.waitForSelector('button[data-testid="send-btn"]', { timeout: 30000 })
    // 等待 CodeBlock 异步组件加载
    await page.waitForTimeout(2000)

    const codeBlockElements = page.locator('.markdown-body .code-block-wrapper')
    const count = await codeBlockElements.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('多次发送后 console 不应有渲染相关 error', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await mockChatAPI(page, buildTextStream('你好！很高兴见到你。'), 80)

    await typeAndSubmit(page, '说"你好"，20字以内')

    await page.waitForFunction(
      () => {
        const el = document.querySelector('.markdown-body')
        return el && (el.textContent || '').length > 0
      },
      { timeout: 30000 }
    )

    await page.waitForSelector('button[data-testid="send-btn"]', { timeout: 30000 })
    await page.waitForTimeout(500)

    const markdownEl = page.locator('.markdown-body').first()
    await expect(markdownEl).toBeVisible()

    const markdownText = await markdownEl.textContent()
    expect(markdownText).toBeTruthy()
    expect(markdownText!.length).toBeGreaterThan(0)

    const renderErrors = consoleErrors.filter(
      (e) =>
        e.includes('render') || e.includes('KaTeX') || e.includes('marked') || e.includes('mount')
    )
    expect(renderErrors).toEqual([])
  })

  test('reasoning 流式输出期间思考内容应逐步增长（验证 v-memo 不屏蔽 reasoning 增量）', async ({ page }) => {
    // 长 reasoning 文本 + 小 chunk + 延迟，确保采样到多个 reasoning 增量
    // 此用例覆盖 v-memo 依赖数组遗漏 reasoning 导致的"一次性显示"回归
    const reasoningText = '让我分析一下这个问题。首先需要理解用户的核心诉求，即流式输出与渲染性能能否兼得。从技术角度看，Vue3 的 v-memo 指令在依赖未变化时会跳过子树 patch。关键在于依赖数组是否包含 reasoning 内容。若遗漏则 reasoning 增量到来时整个子树被跳过，直到 text 开始才一次性显示。'
    const answerText = '可以兼得。'
    await mockChatAPI(page, buildReasoningStream(reasoningText, answerText, 2), 60)

    await typeAndSubmit(page, '分析流式输出问题')

    // 等待思考过程区域出现
    await page.waitForSelector('.thinking-process', { timeout: 30000 })

    const reasoningLengths: number[] = []
    const startTime = Date.now()

    // 在 reasoning 阶段（text 开始前）采样思考内容长度
    while (Date.now() - startTime < 15000) {
      const thinkingEl = page.locator('.thinking-process .whitespace-pre-wrap').first()
      if (await thinkingEl.isVisible()) {
        const text = (await thinkingEl.textContent()) || ''
        reasoningLengths.push(text.length)
      }
      // text 开始后（markdown-body 出现）即可停止采样
      if (await page.locator('.markdown-body').first().isVisible()) break
      await page.waitForTimeout(200)
    }

    expect(reasoningLengths.length).toBeGreaterThan(1)
    // reasoning 内容必须随时间逐步增长，而非一次性出现
    // 若 v-memo 遗漏 reasoning 依赖，此处会失败（只有一个长度值或长度不变）
    const uniqueLengths = new Set(reasoningLengths)
    expect(uniqueLengths.size).toBeGreaterThanOrEqual(2)
  })
})
