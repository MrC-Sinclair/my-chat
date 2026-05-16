import { test, expect } from '@playwright/test'

test.setTimeout(60000)

async function typeAndSubmit(page: import('@playwright/test').Page, text: string) {
  const textarea = page.getByTestId('chat-input')
  await textarea.click()
  await page.waitForTimeout(200)
  await textarea.pressSequentially(text, { delay: 20 })
  await page.waitForTimeout(300)
  await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
  await page.getByTestId('send-btn').click()
}

test.describe('AI对话全流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  test('页面应正确加载标题和输入框', async ({ page }) => {
    await expect(page.getByTestId('chat-header')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeVisible()
  })

  test('发送消息后应显示用户气泡', async ({ page }) => {
    await typeAndSubmit(page, '你好')
    await expect(page.locator('.message-user')).toBeVisible({ timeout: 10000 })
  })

  test('加载中应显示停止按钮', async ({ page }) => {
    await typeAndSubmit(page, '1+1=?')
    await expect(page.getByTestId('stop-btn')).toBeVisible({ timeout: 5000 })
  })
})
