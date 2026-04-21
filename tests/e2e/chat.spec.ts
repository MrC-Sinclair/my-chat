import { test, expect } from '@playwright/test'

test.describe('AI对话全流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat')
  })

  test('页面应正确加载标题和输入框', async ({ page }) => {
    await expect(page.getByTestId('chat-header')).toContainText('AI学习助手')
    await expect(page.getByTestId('chat-input')).toBeVisible()
  })

  test('发送消息后应显示用户气泡', async ({ page }) => {
    await page.getByTestId('chat-input').fill('你好')
    await page.getByTestId('send-btn').click()
    await expect(page.locator('.message-user')).toBeVisible({ timeout: 5000 })
  })

  test('加载中应显示停止按钮', async ({ page }) => {
    await page.getByTestId('chat-input').fill('1+1=?')
    await page.getByTestId('send-btn').click()
    await expect(page.getByTestId('stop-btn')).toBeVisible({ timeout: 3000 })
  })
})
