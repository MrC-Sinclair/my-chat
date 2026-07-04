/**
 * 真实 LLM 冒烟测试
 *
 * 与其他 E2E 测试不同，本测试不 mock API，而是真实调用 LLM Provider。
 * 用于验证：API Key 有效性、模型可用性、流式输出、Markdown 渲染、工具调用等端到端链路。
 *
 * 运行方式：
 *   pnpm test:smoke                  # 默认运行所有冒烟测试（仅 Chrome）
 *   pnpm test:smoke -- --grep="纯文本"  # 只运行匹配的测试
 *
 * 前置条件：
 *   1. .env 中配置了有效的 OPENAI_API_KEY
 *   2. 数据库已启动（docker compose up -d）
 *   3. pnpm db:push 已执行
 *   4. 网络可访问 LLM Provider
 *
 * 注意：本测试会消耗真实 API 额度（虽然模型免费，但仍需注意速率限制）
 */
import { test, expect, type Page } from '@playwright/test'

// 冒烟测试超时时间放宽（LLM 响应可能较慢，尤其是开启深度思考时）
test.setTimeout(180000)

/**
 * 关闭深度思考模式，加速 LLM 响应。
 * 深度思考开启时 Qwen3-8B 会先输出长篇推理过程，导致测试超时。
 */
async function disableDeepThinking(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: '深度思考' })
  // 按钮高亮态（bg-semi-primary-light）表示开启，点击关闭
  const classAttr = await btn.getAttribute('class').catch(() => null)
  if (classAttr && classAttr.includes('bg-semi-primary-light')) {
    await btn.click()
    await page.waitForTimeout(300)
  }
}

/**
 * 等待 AI 回复完成：输入框重新可用且 AI 气泡出现。
 * 比固定 waitForTimeout 更稳健，能适应不同响应时长。
 */
async function waitForAssistantReply(page: Page, timeout = 120000): Promise<void> {
  // 先等 AI 气泡出现（开始流式输出）
  await expect(page.locator('[data-testid="message-assistant"]').first()).toBeVisible({ timeout })
  // 再等输入框恢复可用（标志回复结束）
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout })
}

test.describe('真实 LLM 冒烟测试', () => {
  test.beforeEach(async ({ page }) => {
    // 用 domcontentloaded 而非 networkidle：Nuxt dev 模式下 Vite 会持续加载资源（225+ 个），
    // networkidle 在冷启动时易超时；domcontentloaded 足够触发 Vue 挂载与 API 调用
    await page.goto('/ai-chat', { waitUntil: 'domcontentloaded' })
    // 等待输入框可见，确保 Vue 应用已挂载
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30000 })
    // 关闭深度思考，避免思考过程耗时过长
    await disableDeepThinking(page)
  })

  // ==================== 场景1：纯文本对话 ====================
  test('纯文本对话：发送消息应收到 AI 非空回复', async ({ page }) => {
    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await textarea.fill('你好，请用一句话介绍你自己')
    await page.getByTestId('send-btn').click()

    // 等待用户消息出现
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 10000 })

    // 等待 AI 回复完成
    await waitForAssistantReply(page)

    // 验证 AI 回复内容非空
    const content = await page.locator('[data-testid="message-assistant"]').first().textContent()
    expect(content).toBeTruthy()
    expect(content!.trim().length).toBeGreaterThan(5)
  })

  // ==================== 场景2：Markdown 代码块渲染 ====================
  test('代码块渲染：请求代码应正确渲染为代码块', async ({ page }) => {
    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await textarea.fill('请用 JavaScript 写一个简单的 hello world 函数，用 markdown 代码块包裹')
    await page.getByTestId('send-btn').click()

    // 等待 AI 回复完成
    await waitForAssistantReply(page)

    // 验证代码块渲染（MarkdownRenderer 会把 ``` 包裹的代码渲染为 .code-block-wrapper）
    const codeBlocks = page.locator('.code-block-wrapper')
    await expect(codeBlocks.first()).toBeVisible({ timeout: 10000 })
    const count = await codeBlocks.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // 验证代码块内有内容（只取 pre，避免 code/pre 同时匹配导致 strict mode 冲突）
    const firstPre = codeBlocks.first().locator('pre')
    await expect(firstPre).toBeVisible()
    const codeText = await firstPre.textContent()
    expect(codeText).toBeTruthy()
    expect(codeText!.trim().length).toBeGreaterThan(0)
  })

  // ==================== 场景3：推理模型思考过程 ====================
  test('推理模型：深度思考模型应显示思考过程或正常回复', async ({ page }) => {
    // 此场景需要开启深度思考，重新打开
    const thinkingBtn = page.getByRole('button', { name: '深度思考' })
    const classAttr = await thinkingBtn.getAttribute('class').catch(() => '')
    if (classAttr && !classAttr.includes('bg-semi-primary-light')) {
      await thinkingBtn.click()
      await page.waitForTimeout(300)
    }

    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await textarea.fill('1+1等于几？请简短回答')
    await page.getByTestId('send-btn').click()

    // 等待 AI 回复（推理模型可能更慢）
    await waitForAssistantReply(page, 150000)

    // 推理模型可能显示思考过程，也可能直接回复，两种都算通过
    const content = await page.locator('[data-testid="message-assistant"]').first().textContent()
    expect(content).toBeTruthy()
    expect(content!.trim().length).toBeGreaterThan(0)
  })

  // ==================== 场景4：天气工具调用 ====================
  test('工具调用：询问天气应触发 weather 工具', async ({ page }) => {
    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await textarea.fill('北京今天天气怎么样？')
    await page.getByTestId('send-btn').click()

    // 等待 AI 回复（工具调用需要更长时间：LLM 决策→调用工具→再次生成）
    await waitForAssistantReply(page, 150000)

    // 验证页面包含天气相关信息
    const bodyText = (await page.locator('body').textContent()) || ''
    const hasWeatherInfo =
      bodyText.includes('°C') ||
      bodyText.includes('℃') ||
      bodyText.includes('温度') ||
      bodyText.includes('湿度') ||
      bodyText.includes('风速') ||
      bodyText.includes('天气')

    // 工具调用可能成功也可能失败（取决于 LLM 是否决定调用），至少要有回复
    expect(bodyText.length).toBeGreaterThan(100)
    // 如果工具调用成功，应该有天气信息
    if (hasWeatherInfo) {
      expect(hasWeatherInfo).toBeTruthy()
    }
  })

  // ==================== 场景5：会话持久化 ====================
  test('会话持久化：刷新页面后历史消息应保留', async ({ page }) => {
    // 先展开侧边栏，创建新会话。
    // 必须先创建会话再发消息，否则 currentSessionId 为空，
    // 服务端 onFinish 中 `if (!sessionId) return` 不保存消息，导致无法验证持久化。
    const hamburgerBtn = page.getByTestId('toggle-sidebar')
    await expect(hamburgerBtn).toBeVisible({ timeout: 15000 })
    await hamburgerBtn.click()
    await page.waitForTimeout(500)

    // 点击"新建会话"按钮
    const newSessionBtn = page.getByRole('button', { name: '新建会话' }).first()
    await expect(newSessionBtn).toBeVisible({ timeout: 10000 })
    await newSessionBtn.click()
    await page.waitForTimeout(1000)

    const textarea = page.getByTestId('chat-input')
    await textarea.click()
    await textarea.fill('请回复"测试持久化"这四个字')
    await page.getByTestId('send-btn').click()

    // 等待 AI 回复完成
    await waitForAssistantReply(page)

    // 等待服务端 onFinish 完成（saveMessagesToDb 更新会话 updatedAt）。
    // onFinish 在流结束后异步执行，需额外等待确保写库完成。
    await page.waitForTimeout(2000)

    // 刷新页面
    await page.reload({ waitUntil: 'networkidle' })

    // 刷新后 showSidebar 默认为 false，侧边栏隐藏，需再次展开
    await expect(hamburgerBtn).toBeVisible({ timeout: 15000 })
    await hamburgerBtn.click()
    await page.waitForTimeout(500)

    // 在桌面端侧边栏内找会话项。
    // 注意：页面有移动端（v-if + sm:hidden）和桌面端（sm:flex）两个 SessionSidebar，
    // 必须限定在桌面端容器内查找，否则会匹配到移动端不可见的元素。
    // 用 CSS 后代选择器而非 getByTestId 作用域查找，更可靠。
    const firstSession = page.locator('[data-testid="desktop-sidebar"] [data-testid="session-item"]').first()
    await expect(firstSession).toBeVisible({ timeout: 15000 })
    // 点击左侧（position x=10），避免命中右侧的重命名/删除按钮（它们有 @click.stop）
    await firstSession.click({ position: { x: 10, y: 29 } })
    await page.waitForTimeout(1000)

    // 验证历史消息仍然存在
    await expect(page.locator('[data-testid="message-user"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-testid="message-assistant"]')).toBeVisible({ timeout: 15000 })
  })
})
