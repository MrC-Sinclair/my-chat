/**
 * 跨浏览器测试（Firefox / WebKit）
 *
 * 验证 MarkdownRenderer 在不同浏览器引擎下的渲染行为一致：
 *   - Firefox (Gecko)
 *   - WebKit (Safari)
 *
 * 使用 mock API 消除 LLM 不确定性。
 */
import { test, expect } from '@playwright/test'
import {
  buildTextStream,
  buildCodeBlockStream,
  mockChatAPI
} from './helpers/mock-chat'

test.setTimeout(90000)

test.describe('跨浏览器兼容性', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  test('页面基础元素在所有浏览器中可见', async ({ page }) => {
    await expect(page.getByTestId('chat-header')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()
  })

  test('发送消息后 AI 回复渲染正常', async ({ page }) => {
    await mockChatAPI(page, buildTextStream('测试通过！'), 80)

    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await page.waitForTimeout(200)
    await textarea.pressSequentially('说"测试通过"', { delay: 20 })
    await page.waitForTimeout(300)
    await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
    await page.getByTestId('send-btn').click()

    await page.waitForFunction(
      () => {
        const el = document.querySelector('.markdown-body')
        return el && (el.textContent || '').length > 0
      },
      { timeout: 30000 }
    )

    const markdownEl = page.locator('.markdown-body').first()
    await expect(markdownEl).toBeVisible()
  })

  test('代码块在所有浏览器中正确渲染', async ({ page }) => {
    await mockChatAPI(page, buildCodeBlockStream(), 80)

    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await page.waitForTimeout(200)
    await textarea.pressSequentially('写一个js代码块输出hello', { delay: 20 })
    await page.waitForTimeout(300)
    await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
    await page.getByTestId('send-btn').click()

    // 等待回复完成
    await page.waitForSelector('[data-testid="send-btn"]', { timeout: 30000 })
    // 等待 CodeBlock 异步组件加载（可能需要更长时间）
    await page.waitForTimeout(3000)

    // 使用 waitForFunction 等待 code-block-wrapper 出现
    await page.waitForFunction(
      () => document.querySelectorAll('.code-block-wrapper').length >= 1,
      { timeout: 10000 }
    )

    const codeBlock = page.locator('.markdown-body .code-block-wrapper').first()
    await expect(codeBlock).toBeVisible()
  })

  test('流式输出打字机效果在所有浏览器中正常', async ({ page }) => {
    const longText = '这是一首关于春天的诗。春风拂面花满枝，细雨润物细无声。燕子归来寻旧垒，桃花依旧笑春风。'
    await mockChatAPI(page, buildTextStream(longText, 2), 60)

    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await page.waitForTimeout(200)
    await textarea.pressSequentially('写一首四行诗，纯文字', { delay: 20 })
    await page.waitForTimeout(300)
    await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
    await page.getByTestId('send-btn').click()

    const contentLengths: number[] = []
    const startTime = Date.now()

    while (Date.now() - startTime < 15000) {
      const markdownEl = page.locator('.markdown-body').first()
      if (await markdownEl.isVisible()) {
        const text = (await markdownEl.textContent()) || ''
        contentLengths.push(text.length)
      }
      if (await page.locator('[data-testid="send-btn"]').isVisible()) break
      await page.waitForTimeout(200)
    }

    expect(contentLengths.length).toBeGreaterThan(1)
  })

  test('console 不应有渲染相关 error', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await mockChatAPI(page, buildTextStream('你好！'), 80)

    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await page.waitForTimeout(200)
    await textarea.pressSequentially('你好', { delay: 20 })
    await page.waitForTimeout(300)
    await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
    await page.getByTestId('send-btn').click()

    await page.waitForFunction(
      () => {
        const el = document.querySelector('.markdown-body')
        return el && (el.textContent || '').length > 0
      },
      { timeout: 30000 }
    )

    await page.waitForSelector('[data-testid="send-btn"]', { timeout: 30000 })
    await page.waitForTimeout(500)

    const renderErrors = consoleErrors.filter(
      (e) =>
        e.includes('render') ||
        e.includes('KaTeX') ||
        e.includes('marked') ||
        e.includes('mount') ||
        e.includes('MarkdownRenderer')
    )
    expect(renderErrors).toEqual([])
  })
})
