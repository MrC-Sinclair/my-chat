/**
 * 跨浏览器测试（Firefox / WebKit）
 *
 * 验证 MarkdownRenderer 在不同浏览器引擎下的渲染行为一致：
 *   - Firefox (Gecko)
 *   - WebKit (Safari)
 *
 * 此文件仅包含跨浏览器兼容性相关的测试用例。
 * 通用 E2E 测试在 chat.spec.ts 和 streaming-perf.spec.ts 中，
 * 它们会通过 playwright.config.ts 的多 project 配置自动在所有浏览器上运行。
 */
import { test, expect } from '@playwright/test'

test.describe('跨浏览器兼容性', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  test('页面基础元素在所有浏览器中可见', async ({ page }) => {
    await expect(page.getByTestId('chat-header')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()
  })

  test('发送消息后 AI 回复渲染正常', async ({ page }) => {
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
    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await page.waitForTimeout(200)
    await textarea.pressSequentially('写一个js代码块输出hello', { delay: 20 })
    await page.waitForTimeout(300)
    await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
    await page.getByTestId('send-btn').click()

    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll('.code-block-wrapper')
        return els.length >= 1
      },
      { timeout: 30000 }
    )

    const codeBlock = page.locator('.markdown-body .code-block-wrapper').first()
    await expect(codeBlock).toBeVisible()
  })

  test('流式输出打字机效果在所有浏览器中正常', async ({ page }) => {
    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await page.waitForTimeout(200)
    await textarea.pressSequentially('写一首四行诗，纯文字', { delay: 20 })
    await page.waitForTimeout(300)
    await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
    await page.getByTestId('send-btn').click()

    const contentLengths: number[] = []
    const startTime = Date.now()

    while (Date.now() - startTime < 20000) {
      const markdownEl = page.locator('.markdown-body').first()
      if (await markdownEl.isVisible()) {
        const text = (await markdownEl.textContent()) || ''
        contentLengths.push(text.length)
      }
      if (await page.locator('[data-testid="send-btn"]').isVisible()) break
      await page.waitForTimeout(300)
    }

    expect(contentLengths.length).toBeGreaterThan(1)
  })

  test('console 不应有渲染相关 error', async ({ page, browserName }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

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
