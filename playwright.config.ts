import { defineConfig, devices } from '@playwright/test'

// e2e 专用端口，不复用日常 dev 的 3000。
// 原因：reuseExistingServer 在本地恒为真，而 Playwright 只检查"该端口有响应"就当 server 就绪。
// 实测发生过 3000 被另一个项目占用（它把 /ai-chat 302 到 /my-personalWebsite/ai-chat），
// 于是连「页面能加载标题和输入框」这种最基础的用例都全挂，整轮结果都是噪声。
const E2E_PORT = Number(process.env.E2E_PORT || 3100)
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 并发不设限（CI 才收敛到 1）：e2e 批量失败的真正原因是应用自身的 /api 限流被打满，
  // 与并发、dev server 吞吐、mock 实现方式都无关。抬高阈值（见下方 webServer.env）后实测：
  //   2 workers → 102 passed / 3.2 min；8 workers → 102 passed / 1.7 min
  // 修复前的对照数据（同一份用例，仅限流不同）：1w 13 failed、2w 12 failed、8w 25 failed。
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'tablet',
      use: { ...devices['iPad Pro'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ],
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // 关键：抬高 /api 限流阈值。默认 30 次/60 秒/IP 会被 e2e 自己吃满——每条用例光
    // 页面加载就发 3-4 个 /api 请求，第 7 条左右开始 POST /api/sessions 返回 429，
    // 前端 ensureSession 失败即中止发送，表现成"气泡都没渲染"的假失败（实测确认）。
    env: { RATE_LIMIT_MAX: '100000' },
    // 冷启动 nuxi dev 在本机常超 60s，默认值会让整轮直接中止（报 "did not run" 而非真实失败）
    timeout: 180_000,
    reuseExistingServer: !process.env.CI
  }
})
