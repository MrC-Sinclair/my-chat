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
  // 并发压到 2：本机实测失败主因不是并发而是 `nuxi dev` 在长轮次里逐步劣化（Vite 模块图/内存累积）
  // —— 同一批用例单条跑、整文件跑、11 条小组跑都基本通过，跑满 102 条就成片 waitForFunction 超时。
  // 同一份代码、健康 dev server 下的实测计数：
  //   1 worker → 13 failed / 71 passed（20.2 min）
  //   2 workers → 12 failed / 51 passed（9.4 min）
  //   8 workers → 25 failed / 30 passed（3.6 min 后中止）
  // 即 1 与 2 无差别、8 明显更差，所以取 2 换回一半时间。要真正修掉，得把 mockChatAPI 从
  // 替换 window.fetch 改成 page.route 拦截，这样可改跑构建产物、也就没有 dev server 劣化问题
  // （见 AGENTS.md 踩坑清单：preview 下 window.fetch 替换不生效）。
  // 跑全量前先确认 3000 端口没有僵尸 dev server：reuseExistingServer 在本地恒为真，
  // 会静默复用一个坏实例（我这边就因此误判过一次"零失败"）。
  workers: 2,
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
    // 冷启动 nuxi dev 在本机常超 60s，默认值会让整轮直接中止（报 "did not run" 而非真实失败）
    timeout: 180_000,
    reuseExistingServer: !process.env.CI
  }
})
