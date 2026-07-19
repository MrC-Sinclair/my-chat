/**
 * generateImage 工具 E2E 测试
 *
 * 覆盖场景：
 *
 * 一、Agent 路径（LLM 自主调用 generateImage 工具）：
 *   - 加载中：spinner + "正在生成图片..." 文案
 *   - 成功：图片缩略图 + 耗时 + seed + 3 个 icon button（放大/下载/复制链接）+ ImgBB warning 提示
 *   - 失败：error 卡片 + "等待 AI 自主决定是否重试..."
 *   - output-error 状态：兜底错误展示
 *
 * 二、Workflow 路径（用户点击"生图"按钮触发）：
 *   - 打开/关闭生图面板（image-gen-btn 切换）
 *   - 提交后显示加载状态
 *   - 成功：图片消息被追加到对话流（MarkdownRenderer 渲染 img）+ success toast
 *   - ImgBB 降级：warning toast
 *   - 失败：error toast
 *
 * 三、Agent 自动生图 toggle chip：
 *   - toolCalling=true 模型可见
 *   - toolCalling=false 模型（GLM-Z1/DeepSeek-R1）隐藏
 *   - 点击切换状态
 *
 * 使用 mock API 消除 LLM 不确定性（mockChatAPI + page.route）。
 *
 * 注：图片下载按钮涉及 fetch+blob + URL.createObjectURL，无法在 E2E 验证下载文件落盘，
 *     仅验证按钮可见即可。复制链接涉及 navigator.clipboard，需要权限，仅验证按钮可见即可。
 */
import { test, expect } from '@playwright/test'
import {
  sseChunk,
  buildTextStream,
  mockChatAPI,
  typeAndSubmit,
  waitForResponse,
  waitForAssistantMessage
} from './helpers/mock-chat'

test.setTimeout(120000)

test.describe.configure({ mode: 'serial', retries: 1 })

// ==================== 本地 stream 构建函数 ====================

/** 构造 generateImage 工具调用的 SSE 流 */
function buildGenerateImageStream(options: {
  toolCallId: string
  prompt: string
  output: Record<string, unknown>
  answerText: string
}): string {
  const { toolCallId, prompt, output, answerText } = options
  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  chunks.push(sseChunk({ type: 'tool-input-start', toolCallId, toolName: 'generateImage' }))
  const inputJson = JSON.stringify({ prompt })
  chunks.push(sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: inputJson.slice(0, 5) }))
  chunks.push(sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: inputJson.slice(5) }))
  chunks.push(
    sseChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName: 'generateImage',
      input: { prompt }
    })
  )
  chunks.push(sseChunk({ type: 'tool-output-available', toolCallId, output }))

  // 工具调用后的文本回复（按 5 字符切片模拟真实流式）
  const textId = 'txt-1'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))
  for (let i = 0; i < answerText.length; i += 5) {
    chunks.push(sseChunk({ type: 'text-delta', id: textId, delta: answerText.slice(i, i + 5) }))
  }
  chunks.push(sseChunk({ type: 'text-end', id: textId }))

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

/** 成功路径：图片 + 耗时 + seed */
function buildGenerateImageSuccessStream(): string {
  return buildGenerateImageStream({
    toolCallId: 'call-gen-1',
    prompt: 'A white cat under the moonlight',
    output: {
      imageUrl: 'https://i.ibb.co/test/kolors-cat.png',
      markdown: '![A white cat under the moonlight](https://i.ibb.co/test/kolors-cat.png)',
      seed: 123456789,
      inferenceTime: 8500
    },
    answerText: '已为你生成一张白猫月夜图。'
  })
}

/** 成功路径（带 ImgBB 降级 warning） */
function buildGenerateImageFallbackStream(): string {
  return buildGenerateImageStream({
    toolCallId: 'call-gen-2',
    prompt: 'A red flower',
    output: {
      imageUrl: 'https://tmp.siliconflow.cn/test/red-flower.png',
      markdown: '![A red flower](https://tmp.siliconflow.cn/test/red-flower.png)',
      seed: 987654321,
      inferenceTime: 7200,
      warning: '图片链接 1 小时后失效，请及时保存'
    },
    answerText: '已生成图片，请尽快保存。'
  })
}

/** 失败路径：服务不可用 */
function buildGenerateImageErrorStream(): string {
  return buildGenerateImageStream({
    toolCallId: 'call-gen-err',
    prompt: 'A complex scene',
    output: {
      error: '图片生成服务不可用',
      detail: 'API 请求超时（60秒）',
      query: { prompt: 'A complex scene' }
    },
    answerText: '抱歉，图片生成服务暂时不可用，请稍后再试。'
  })
}

/** output-error 状态（不返回 output，只返回 errorText） */
function buildGenerateImageOutputErrorStream(): string {
  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  const toolCallId = 'call-gen-oe'
  chunks.push(sseChunk({ type: 'tool-input-start', toolCallId, toolName: 'generateImage' }))
  chunks.push(
    sseChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName: 'generateImage',
      input: { prompt: 'A scene' }
    })
  )
  chunks.push(
    sseChunk({
      type: 'tool-output-error',
      toolCallId,
      errorText: '工具执行异常：网络中断'
    })
  )

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

// ==================== Workflow 路径 mock ====================

/**
 * Mock /api/generate-image 返回 JSON 响应
 * 注：page.route 拦截比 page.evaluate 覆盖 fetch 更适合非流式 JSON 接口
 */
async function mockGenerateImageAPI(
  page: import('@playwright/test').Page,
  response: Record<string, unknown>,
  status = 200
) {
  await page.route('**/api/generate-image', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response)
    })
  })
}

/**
 * Mock 远程图片 URL 返回占位 PNG
 *
 * 为什么需要：mock 图片 URL（如 https://i.ibb.co/test/*.png）实际请求会 404，
 * 浏览器把 <img> 渲染为 broken image，Playwright 的 toBeVisible() 会判定为 hidden。
 * 通过返回 1x1 透明 PNG 让 <img> 成功加载，从而使元素 visible。
 *
 * 1x1 透明 PNG base64（68 字节）— 标准 PNG 头 + IHDR + IDAT + IEND
 */
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function mockImageUrls(page: import('@playwright/test').Page) {
  await page.route('**/*.png', async (route) => {
    const url = route.request().url()
    // 仅 mock 测试用的远程 URL，本地 /_nuxt/ 等资源透传
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64')
      })
    } else {
      await route.continue()
    }
  })
}

// ==================== 测试用例 ====================

test.describe('generateImage 工具', () => {
  test.beforeEach(async ({ page }) => {
    // 全局 mock 远程图片 URL，避免 <img> broken 导致 toBeVisible 失败
    await mockImageUrls(page)
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  // ================================================================
  // 一、Agent 路径：工具调用流式渲染
  // ================================================================
  test.describe('Agent 路径 — 工具调用流', () => {
    test('应显示 loading → 成功结果完整流程', async ({ page }) => {
      await mockChatAPI(page, buildGenerateImageSuccessStream(), 80)

      await typeAndSubmit(page, '帮我画一只白猫')

      // 等待 loading 出现（"正在生成图片"）
      await expect(page.locator('text=正在生成图片')).toBeVisible({ timeout: 15000 })

      // 等待结果出现（"AI 生成图片"）
      await expect(page.locator('text=AI 生成图片').first()).toBeVisible({ timeout: 30000 })

      // 验证耗时显示（8500ms = 8.5 秒）
      await expect(page.locator('text=耗时 8.5 秒')).toBeVisible({ timeout: 5000 })

      // 验证 seed 显示
      await expect(page.locator('text=seed: 123456789')).toBeVisible({ timeout: 5000 })

      // 验证缩略图渲染（Tailwind 类名 max-w-[200px] 通过 class*= 选择器匹配）
      await expect(page.locator('img[alt*="AI 生成图片"].block').first()).toBeVisible({
        timeout: 5000
      })

      // 验证 3 个操作按钮可见
      await expect(page.locator('button[aria-label="放大查看"]')).toBeVisible({ timeout: 3000 })
      await expect(page.locator('button[aria-label="下载图片"]')).toBeVisible({ timeout: 3000 })
      await expect(page.locator('button[aria-label="复制图片链接"]')).toBeVisible({
        timeout: 3000
      })

      // 等待 AI 回复完成
      await waitForResponse(page, 60000)
    })

    test('应显示 ImgBB 降级 warning 提示', async ({ page }) => {
      await mockChatAPI(page, buildGenerateImageFallbackStream(), 80)

      await typeAndSubmit(page, '画一朵红花')

      // 等待结果出现
      await expect(page.locator('text=AI 生成图片').first()).toBeVisible({ timeout: 30000 })

      // 验证 warning 提示显示
      await expect(page.locator('text=图片链接 1 小时后失效，请及时保存')).toBeVisible({
        timeout: 5000
      })

      await waitForResponse(page, 60000)
    })

    test('应显示失败状态和等待重试提示', async ({ page }) => {
      await mockChatAPI(page, buildGenerateImageErrorStream(), 80)

      await typeAndSubmit(page, '画一个复杂场景')

      // 等待 loading
      await expect(page.locator('text=正在生成图片')).toBeVisible({ timeout: 15000 })

      // 等待错误文案出现
      await expect(page.locator('text=图片生成服务不可用')).toBeVisible({ timeout: 30000 })

      // 验证错误详情显示
      await expect(page.locator('text=API 请求超时（60秒）').first()).toBeVisible({
        timeout: 5000
      })

      // 验证等待 AI 重试提示
      await expect(page.locator('text=等待 AI 自主决定是否重试').first()).toBeVisible({
        timeout: 5000
      })

      await waitForResponse(page, 60000)
    })

    test('应处理 output-error 状态（工具执行异常）', async ({ page }) => {
      await mockChatAPI(page, buildGenerateImageOutputErrorStream(), 80)

      await typeAndSubmit(page, '画一个场景')

      // 等待 "图片生成失败" 文案出现
      await expect(page.locator('text=图片生成失败')).toBeVisible({ timeout: 30000 })

      // 验证 errorText 透传显示
      await expect(page.locator('text=工具执行异常：网络中断').first()).toBeVisible({
        timeout: 5000
      })

      await waitForResponse(page, 60000)
    })

    test('放大查看按钮应打开模态框显示原图', async ({ page }) => {
      await mockChatAPI(page, buildGenerateImageSuccessStream(), 80)

      await typeAndSubmit(page, '画一只猫')

      // 等待结果出现
      await expect(page.locator('text=AI 生成图片').first()).toBeVisible({ timeout: 30000 })

      // 点击放大查看按钮
      const zoomBtn = page.locator('button[aria-label="放大查看"]').first()
      await zoomBtn.click()

      // 验证模态框打开 + 原图渲染
      await expect(page.locator('img[alt*="AI 生成图片原图"]')).toBeVisible({ timeout: 5000 })

      // 点击模态框的关闭按钮（aria-label="关闭"）关闭模态框
      const closeBtn = page.locator('button[aria-label="关闭"]').last()
      await closeBtn.click()

      // 验证模态框关闭
      await expect(page.locator('img[alt*="AI 生成图片原图"]')).toHaveCount(0, {
        timeout: 3000
      })

      await waitForResponse(page, 60000)
    })
  })

  // ================================================================
  // 二、Workflow 路径：用户点击按钮触发生图
  // ================================================================
  test.describe('Workflow 路径 — 按钮触发', () => {
    test('打开生图面板，填写 prompt 后提交应渲染图片消息', async ({ page }) => {
      // Mock generate-image API 返回成功
      await mockGenerateImageAPI(page, {
        imageUrl: 'https://i.ibb.co/test/workflow-cat.png',
        markdown: '![A blue dog](https://i.ibb.co/test/workflow-cat.png)',
        seed: 111222333,
        inferenceTime: 7500
      })

      // 点击生图按钮打开面板
      await page.getByTestId('image-gen-btn').click()

      // 等待面板展开（验证 prompt 输入框可见）
      const promptInput = page.getByTestId('image-prompt-input')
      await expect(promptInput).toBeVisible({ timeout: 3000 })

      // 填写 prompt
      await promptInput.click()
      await promptInput.fill('A blue dog in the park')

      // 点击提交按钮
      const submitBtn = page.getByTestId('generate-image-submit')
      await expect(submitBtn).toBeEnabled({ timeout: 3000 })
      await submitBtn.click()

      // 验证对话流中出现图片消息（MarkdownRenderer 渲染 img）
      await expect(page.locator('img[src*="workflow-cat.png"]').first()).toBeVisible({
        timeout: 15000
      })

      // 验证 success toast 显示
      await expect(page.locator('text=图片已生成')).toBeVisible({ timeout: 5000 })

      // 验证面板关闭：检查 image-gen-btn 的 aria-label 切换为"打开生图面板"
      // 注：面板用 max-height:0 + overflow:hidden 折叠，元素仍在 DOM 中且 textarea 本身 visible，
      // 所以不能用 toHaveCount(0) 或 toBeHidden()，改用按钮状态判断
      await expect(page.getByTestId('image-gen-btn')).toHaveAttribute(
        'aria-label',
        '打开生图面板',
        { timeout: 3000 }
      )
    })

    test('ImgBB 降级时应显示 warning toast', async ({ page }) => {
      await mockGenerateImageAPI(page, {
        imageUrl: 'https://tmp.siliconflow.cn/test/fallback-img.png',
        markdown: '![fallback](https://tmp.siliconflow.cn/test/fallback-img.png)',
        seed: 444555666,
        inferenceTime: 6500,
        warning: '图片链接 1 小时后失效，请及时保存'
      })

      await page.getByTestId('image-gen-btn').click()
      const promptInput = page.getByTestId('image-prompt-input')
      await expect(promptInput).toBeVisible({ timeout: 3000 })
      await promptInput.click()
      await promptInput.fill('test prompt for fallback')

      await page.getByTestId('generate-image-submit').click()

      // 验证图片消息渲染
      await expect(page.locator('img[src*="fallback-img.png"]').first()).toBeVisible({
        timeout: 15000
      })

      // 验证 warning toast 显示
      await expect(page.locator('text=图片链接 1 小时后失效，请及时保存')).toBeVisible({
        timeout: 5000
      })
    })

    test('生图失败应显示 error toast', async ({ page }) => {
      await mockGenerateImageAPI(page, { error: 'Internal Server Error' }, 500)

      await page.getByTestId('image-gen-btn').click()
      const promptInput = page.getByTestId('image-prompt-input')
      await expect(promptInput).toBeVisible({ timeout: 3000 })
      await promptInput.click()
      await promptInput.fill('test failure case')

      await page.getByTestId('generate-image-submit').click()

      // 验证 error toast 显示
      await expect(page.locator('text=/图片生成失败/').first()).toBeVisible({
        timeout: 10000
      })

      // 验证图片消息未出现
      await expect(page.locator('img[src*="failure"]')).toHaveCount(0)
    })

    test('点击关闭按钮（✕）应关闭生图面板', async ({ page }) => {
      await page.getByTestId('image-gen-btn').click()
      const promptInput = page.getByTestId('image-prompt-input')
      await expect(promptInput).toBeVisible({ timeout: 3000 })

      // 点击关闭按钮（panel 内部的 ✕，与 image-gen-btn 是不同的按钮）
      const closeBtn = page.locator('button[aria-label="关闭生图面板"]').first()
      await closeBtn.click()

      // 验证面板关闭：image-gen-btn 的 aria-label 切换为"打开生图面板"
      // 注：面板用 max-height:0 + overflow:hidden 折叠，textarea 仍在 DOM 中且本身 visible，
      // 不能用 toBeHidden() 或 toHaveCount(0)，改用 toggle 按钮状态判断
      await expect(page.getByTestId('image-gen-btn')).toHaveAttribute(
        'aria-label',
        '打开生图面板',
        { timeout: 3000 }
      )
    })
  })

  // ================================================================
  // 三、Agent 自动生图 toggle chip
  // ================================================================
  test.describe('Agent 自动生图 toggle chip', () => {
    test('默认 Qwen3-8B（toolCalling=true）应显示「生图」chip', async ({ page }) => {
      const chip = page.locator('button', { hasText: '生图' }).first()
      await expect(chip).toBeVisible({ timeout: 10000 })
    })

    test('切换到 GLM-Z1（toolCalling=false）时「生图」chip 不渲染', async ({ page }) => {
      const glmChip = page.locator('[data-testid="model-chip"]', { hasText: 'GLM-Z1' }).first()
      await glmChip.click()
      await page.waitForTimeout(500)

      const chip = page.locator('button', { hasText: '生图' })
      await expect(chip).toHaveCount(0, { timeout: 5000 })
    })

    test('切换到 DeepSeek-R1（toolCalling=false）时「生图」chip 不渲染', async ({ page }) => {
      const r1Chip = page.locator('[data-testid="model-chip"]', { hasText: 'DeepSeek-R1' }).first()
      await r1Chip.click()
      await page.waitForTimeout(500)

      const chip = page.locator('button', { hasText: '生图' })
      await expect(chip).toHaveCount(0, { timeout: 5000 })
    })
  })

  // ================================================================
  // 四、纯文本对话不应触发 generateImage 工具
  // ================================================================
  test.describe('纯文本对话', () => {
    test('不应出现 generateImage 工具调用', async ({ page }) => {
      await mockChatAPI(page, buildTextStream('这是纯文本回复'), 80)

      await typeAndSubmit(page, '你好')

      await waitForAssistantMessage(page, 30000)
      await waitForResponse(page, 60000)

      // 不应出现 generateImage 工具相关 UI
      await expect(page.locator('text=正在生成图片')).toHaveCount(0)
      await expect(page.locator('text=AI 生成图片')).toHaveCount(0)
      await expect(page.locator('text=图片生成失败')).toHaveCount(0)
    })
  })
})
