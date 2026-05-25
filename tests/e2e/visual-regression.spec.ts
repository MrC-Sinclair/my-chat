/**
 * 视觉回归测试（Screenshot Diff）
 *
 * 通过 Playwright 截图对比，检测 UI 渲染结果是否发生意外视觉变化。
 * 首次运行生成基线截图，后续运行与基线对比，差异超过阈值则报错。
 *
 * 注意：AI 回复内容不确定，不适合做截图对比。
 * 本测试只对确定性 UI 元素（空页面、视口布局、静态注入内容）做截图。
 */
import { test, expect } from '@playwright/test'

test.setTimeout(120000)

test.describe('视觉回归测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  test('空页面初始状态截图应与基线一致', async ({ page }) => {
    const header = page.getByTestId('chat-header')
    await expect(header).toBeVisible()

    await expect(page).toHaveScreenshot('empty-chat-page.png', {
      maxDiffPixelRatio: 0.01,
      fullPage: true
    })
  })

  test('平板视口下页面布局截图应与基线一致', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.waitForTimeout(500)

    const header = page.getByTestId('chat-header')
    await expect(header).toBeVisible()

    await expect(page).toHaveScreenshot('tablet-layout.png', {
      maxDiffPixelRatio: 0.01,
      fullPage: true
    })
  })

  test('手机视口下页面布局截图应与基线一致', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(500)

    const header = page.getByTestId('chat-header')
    await expect(header).toBeVisible()

    await expect(page).toHaveScreenshot('mobile-layout.png', {
      maxDiffPixelRatio: 0.01,
      fullPage: true
    })
  })

  test('Markdown 静态内容渲染截图应与基线一致', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.markdown-body') || document.createElement('div')
      if (!container.classList.contains('markdown-body')) {
        container.className = 'markdown-body prose prose-sm max-w-none'
        document.body.appendChild(container)
      }
      container.innerHTML = `
        <h2>标题测试</h2>
        <p>这是一段普通文字，包含<strong>加粗</strong>和<em>斜体</em>。</p>
        <ul>
          <li>列表项 1</li>
          <li>列表项 2</li>
          <li>列表项 3</li>
        </ul>
        <blockquote>引用块内容</blockquote>
        <p>行内代码: <code>const x = 1</code></p>
        <table>
          <thead><tr><th>列A</th><th>列B</th></tr></thead>
          <tbody><tr><td>值1</td><td>值2</td></tr></tbody>
        </table>
      `
    })
    await page.waitForTimeout(500)

    const markdownEl = page.locator('.markdown-body').first()
    await expect(markdownEl).toHaveScreenshot('static-markdown-content.png', {
      maxDiffPixelRatio: 0.02
    })
  })

  test('代码块静态渲染截图应与基线一致', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.querySelector('.markdown-body') || document.createElement('div')
      if (!container.classList.contains('markdown-body')) {
        container.className = 'markdown-body prose prose-sm max-w-none'
        document.body.appendChild(container)
      }
      container.innerHTML = `
        <p>下面是一个代码块：</p>
        <div class="code-block-wrapper group relative rounded-lg border border-gray-200 bg-gray-900 my-3">
          <div class="flex items-center justify-between px-4 py-2 bg-gray-800 rounded-t-lg border-b border-gray-700">
            <span class="text-xs text-gray-400 font-mono">js</span>
            <button class="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white rounded transition-colors">复制</button>
          </div>
          <pre class="p-4 overflow-x-auto"><code class="text-sm font-mono leading-relaxed language-js">const greeting = "hello world";
console.log(greeting);</code></pre>
        </div>
      `
    })
    await page.waitForTimeout(500)

    const codeBlock = page.locator('.markdown-body .code-block-wrapper').first()
    await expect(codeBlock).toHaveScreenshot('static-code-block.png', {
      maxDiffPixelRatio: 0.02
    })
  })
})
