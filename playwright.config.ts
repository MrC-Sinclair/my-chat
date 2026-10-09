import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 固定单 worker：本机实测 `nuxi dev` 在并发下服务不过来（失败的都是依赖 mock 的用例，
  // 报错统一是 waitForFunction 90s 超时）。同一份代码、同一个健康 dev server 下：
  //   8 workers → 25 failed / 30 passed（3.6 min 后中止）
  //   2 workers → 12 failed / 51 passed（9.4 min）
  //   1 worker  → 0 硬失败，6 条靠重试才过（20.2 min）
  // 注意别用 `nuxi preview` 提速：mockChatAPI 靠替换 window.fetch 生效，只对 dev 有效
  // （见 AGENTS.md 踩坑清单）。另外本地跑全量前确认 3000 端口没有僵尸 dev server，
  // 否则 reuseExistingServer 会静默复用一个坏实例，让整轮结果失真。
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
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
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // 冷启动 nuxi dev 在本机常超 60s，默认值会让整轮直接中止（报 "did not run" 而非真实失败）
    timeout: 180_000,
    reuseExistingServer: !process.env.CI
  }
})
