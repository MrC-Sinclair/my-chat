/**
 * MarkdownRenderer 流式渲染性能 E2E 测试
 *
 * 在真实浏览器中验证流式渲染的增量更新行为。
 */
import { test, expect } from '@playwright/test'

test.setTimeout(90000)

async function fillAndSubmit(page: import('@playwright/test').Page, text: string) {
  const textarea = page.locator('textarea[data-testid="chat-input"]')
  await textarea.waitFor({ state: 'visible', timeout: 10000 })

  await textarea.click()
  await page.waitForTimeout(200)

  await textarea.pressSequentially(text, { delay: 20 })
  await page.waitForTimeout(500)

  const sendBtn = page.locator('button[data-testid="send-btn"]')
  await expect(sendBtn).toBeEnabled({ timeout: 5000 })

  await sendBtn.click()
}

test.describe('流式渲染性能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  test('流式输出期间 .markdown-body 内容应逐步增长（验证打字机效果）', async ({ page }) => {
    await fillAndSubmit(page, '用Markdown写一篇100字短文，包含标题和列表，纯文字不要代码块')

    // 等待 markdown-body 出现且有实际内容
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.markdown-body')
        return el && (el.textContent || '').length > 10
      },
      { timeout: 30000 }
    )
    await page.waitForTimeout(500)

    const contentLengths: number[] = []
    const startTime = Date.now()

    while (Date.now() - startTime < 20000) {
      const markdownEl = page.locator('.markdown-body').first()
      if (await markdownEl.isVisible()) {
        const text = (await markdownEl.textContent()) || ''
        contentLengths.push(text.length)
      }
      if (await page.locator('button[data-testid="send-btn"]').isVisible()) break
      await page.waitForTimeout(300)
    }

    expect(contentLengths.length).toBeGreaterThan(1)

    const uniqueLengths = new Set(contentLengths)
    expect(uniqueLengths.size).toBeGreaterThanOrEqual(3)
  })

  test('含代码块的流式输出：代码块应正确渲染', async ({ page }) => {
    await fillAndSubmit(page, '用js写一个hello world，要有 ```js 代码块')

    await page.waitForSelector('button[data-testid="send-btn"]', { timeout: 30000 })
    await page.waitForTimeout(500)

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

    await fillAndSubmit(page, '说"你好"，20字以内')

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
