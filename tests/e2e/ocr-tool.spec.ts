/**
 * OCR 工具 E2E 测试
 *
 * 覆盖场景：
 * - OCR toggle 按钮可见性（按模型 toolCalling 能力）
 * - OCR toggle 开关交互（点击 + 高亮 + 图片上传联动）
 * - OCR 工具调用流式渲染（loading → result）
 * - OCR 工具调用失败渲染（error 卡片）
 * - 切换模型时 OCR toggle 自动关闭
 * - 纯文本对话时 OCR 工具不调用（mock 不返回 tool 事件）
 *
 * 使用 mock API 消除 LLM 不确定性
 */
import { test, expect } from '@playwright/test'
import {
  buildTextStream,
  buildOcrToolStream,
  buildOcrToolErrorStream,
  mockChatAPI,
  typeAndSubmit,
  waitForResponse,
  waitForAssistantMessage
} from './helpers/mock-chat'

test.setTimeout(120000)

test.describe.configure({ mode: 'serial', retries: 1 })

test.describe('OCR 工具', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  // ================================================================
  // OCR toggle 按钮可见性
  // ================================================================
  test.describe('OCR toggle 可见性', () => {
    test('默认 Qwen3-8B（toolCalling=true）应显示 OCR 按钮', async ({ page }) => {
      // 默认模型是 Qwen3-8B，应显示 OCR 按钮
      const ocrBtn = page.locator('button', { hasText: 'OCR' }).first()
      await expect(ocrBtn).toBeVisible({ timeout: 10000 })
    })

    test('切换到 GLM-Z1（toolCalling=false）时 OCR 按钮不渲染', async ({ page }) => {
      // 点击 GLM-Z1 模型 chip
      const glmChip = page.locator('[data-testid="model-chip"]', { hasText: 'GLM-Z1' }).first()
      await glmChip.click()
      await page.waitForTimeout(500)

      // OCR 按钮应不再可见
      const ocrBtn = page.locator('button', { hasText: 'OCR' })
      await expect(ocrBtn).toHaveCount(0, { timeout: 5000 })
    })

    test('切换到 DeepSeek-R1（toolCalling=false）时 OCR 按钮不渲染', async ({ page }) => {
      const r1Chip = page.locator('[data-testid="model-chip"]', { hasText: 'DeepSeek-R1' }).first()
      await r1Chip.click()
      await page.waitForTimeout(500)

      const ocrBtn = page.locator('button', { hasText: 'OCR' })
      await expect(ocrBtn).toHaveCount(0, { timeout: 5000 })
    })
  })

  // ================================================================
  // OCR toggle 开关交互
  // ================================================================
  test.describe('OCR toggle 开关', () => {
    test('点击 OCR 按钮应切换高亮状态', async ({ page }) => {
      const ocrBtn = page.locator('button', { hasText: 'OCR' }).first()

      // 初始状态：未高亮（bg-semi-fill-0）
      await expect(ocrBtn).toBeVisible()
      await expect(ocrBtn).toHaveClass(/bg-semi-fill-0/)

      // 点击开启
      await ocrBtn.click()
      await page.waitForTimeout(300)

      // 应高亮（bg-semi-primary-light）
      await expect(ocrBtn).toHaveClass(/bg-semi-primary-light/)

      // 再次点击关闭
      await ocrBtn.click()
      await page.waitForTimeout(300)
      await expect(ocrBtn).toHaveClass(/bg-semi-fill-0/)
    })

    test('OCR 开启时非视觉模型图片上传按钮应启用', async ({ page }) => {
      // 默认 Qwen3-8B（vision=false, toolCalling=true）
      const ocrBtn = page.locator('button', { hasText: 'OCR' }).first()
      const fileInput = page.locator('input[type="file"]')

      // 初始：OCR 关闭，图片上传应禁用
      await expect(fileInput).toBeDisabled()

      // 开启 OCR
      await ocrBtn.click()
      await page.waitForTimeout(300)

      // 图片上传应启用
      await expect(fileInput).toBeEnabled()
    })

    test('从 Qwen3-8B（OCR 开启）切换到 GLM-Z1 时 OCR 自动关闭', async ({ page }) => {
      // 先开启 OCR
      const ocrBtn = page.locator('button', { hasText: 'OCR' }).first()
      await ocrBtn.click()
      await page.waitForTimeout(300)
      await expect(ocrBtn).toHaveClass(/bg-semi-primary-light/)

      // 切换到 GLM-Z1
      const glmChip = page.locator('[data-testid="model-chip"]', { hasText: 'GLM-Z1' }).first()
      await glmChip.click()
      await page.waitForTimeout(500)

      // OCR 按钮应消失（supportsOcr=false）
      await expect(page.locator('button', { hasText: 'OCR' })).toHaveCount(0, { timeout: 5000 })

      // 切回 Qwen3-8B
      const qwenChip = page.locator('[data-testid="model-chip"]', { hasText: 'Qwen3-8B' }).first()
      await qwenChip.click()
      await page.waitForTimeout(500)

      // OCR 按钮应重新出现，且处于关闭状态（不保留之前的开启）
      const ocrBtnAfter = page.locator('button', { hasText: 'OCR' }).first()
      await expect(ocrBtnAfter).toBeVisible({ timeout: 5000 })
      await expect(ocrBtnAfter).toHaveClass(/bg-semi-fill-0/)
    })
  })

  // ================================================================
  // OCR 工具调用流式渲染
  // ================================================================
  test.describe('OCR 工具调用流', () => {
    test('应显示 OCR loading → result 完整流程', async ({ page }) => {
      // mock 返回 OCR 工具调用流
      await mockChatAPI(page, buildOcrToolStream(), 80)

      // 启用 OCR toggle：getVisibleToolInvocations 会在 enableOcr=false 时过滤掉 OCR 工具调用
      const ocrBtn = page.locator('button', { hasText: 'OCR' }).first()
      await ocrBtn.click()
      await page.waitForTimeout(300)

      await typeAndSubmit(page, '提取图片中的文字')

      // 等待 OCR loading 出现（"正在识别图片中的文字..."）
      await expect(
        page.locator('text=正在识别图片中的文字')
      ).toBeVisible({ timeout: 15000 })

      // 等待 OCR 结果出现（"OCR 识别完成"）
      await expect(page.locator('text=OCR 识别完成')).toBeVisible({ timeout: 30000 })

      // 等待 AI 回复完成
      await waitForResponse(page, 60000)

      // 验证 OCR 结果卡片中包含识别的文字预览
      await expect(page.locator('text=提取结果').first()).toBeVisible({ timeout: 10000 })
    })

    test('应显示 OCR 错误卡片', async ({ page }) => {
      await mockChatAPI(page, buildOcrToolErrorStream(), 80)

      // 启用 OCR toggle：getVisibleToolInvocations 会在 enableOcr=false 时过滤掉 OCR 工具调用
      const ocrBtn = page.locator('button', { hasText: 'OCR' }).first()
      await ocrBtn.click()
      await page.waitForTimeout(300)

      await typeAndSubmit(page, '提取图片中的文字')

      // 等待 OCR loading
      await expect(page.locator('text=正在识别图片中的文字')).toBeVisible({ timeout: 15000 })

      // 等待错误卡片出现（"OCR 处理失败"）
      await expect(page.locator('text=OCR 处理失败')).toBeVisible({ timeout: 30000 })

      // 验证错误详情显示
      await expect(page.locator('text=URL 安全检查失败').first()).toBeVisible({ timeout: 5000 })

      await waitForResponse(page, 60000)
    })

    test('纯文本对话不应出现 OCR 工具调用', async ({ page }) => {
      // mock 返回纯文本流（无工具调用事件）
      await mockChatAPI(page, buildTextStream('这是纯文本回复'), 80)

      await typeAndSubmit(page, '你好')

      // 等待 AI 回复
      await waitForAssistantMessage(page, 30000)
      await waitForResponse(page, 60000)

      // 不应出现 OCR 工具相关 UI
      await expect(page.locator('text=正在识别图片中的文字')).toHaveCount(0)
      await expect(page.locator('text=OCR 识别完成')).toHaveCount(0)
    })
  })
})
