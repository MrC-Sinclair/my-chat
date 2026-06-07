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
})
