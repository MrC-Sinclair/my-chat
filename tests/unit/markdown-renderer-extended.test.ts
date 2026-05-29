/**
 * MarkdownRenderer 内存泄漏 + SSR 水合 + 压力测试
 *
 * 测试8: 内存泄漏 — segments/RAF 在组件卸载后被释放
 * 测试11: SSR 水合 — requestAnimationFrame 在 SSR 环境下不报错
 * 测试12: 压力测试 — 大量代码块 + 高频更新下渲染可控
 *
 * 注意：MarkdownRenderer 已从 createApp 动态挂载重构为
 * parseSegments + 声明式 <CodeBlock> 渲染，代码块 DOM 元素
 * 的类名为 .code-block-wrapper（不再使用 data-vue-mounted）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import MarkdownRenderer from '~/components/chat/MarkdownRenderer.vue'
import CodeBlock from '~/components/chat/CodeBlock.vue'

let rafCallbacks: Array<() => void> = []

function setupRafMock() {
  rafCallbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb: FrameRequestCallback): number => {
      rafCallbacks.push(() => cb(performance.now()))
      return rafCallbacks.length
    }
  )
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafCallbacks[id - 1] = () => {}
  })
}

function restoreRafMock() {
  vi.restoreAllMocks()
}

async function flushRafAndTick() {
  while (rafCallbacks.length > 0) {
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    cbs.forEach((cb) => cb())
  }
  await nextTick()
}

const globalStubs = {
  AsyncCodeBlock: CodeBlock
}

function getContainer(wrapper: VueWrapper): HTMLElement {
  return wrapper.find('.markdown-body').element as HTMLElement
}

/** 获取声明式渲染的代码块 wrapper DOM 元素 */
function getCodeBlockWrappers(wrapper: VueWrapper): Element[] {
  return Array.from(getContainer(wrapper).querySelectorAll('.code-block-wrapper'))
}

function generateLongContent(codeBlockCount: number, extraText: string): string {
  const parts: string[] = [extraText]
  for (let i = 0; i < codeBlockCount; i++) {
    parts.push(`\n\`\`\`js\n// 代码块 ${i + 1}\nconst x${i} = ${i};\nconsole.log(x${i});\n\`\`\`\n`)
  }
  return parts.join('\n')
}

// ================================================================
// 测试8: 内存泄漏
// ================================================================
describe('测试8: 内存泄漏', () => {
  beforeEach(setupRafMock)
  afterEach(restoreRafMock)

  it('组件卸载后 segments 应被清空', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '```js\nconst x = 1;\n```' },
      global: { stubs: globalStubs }
    })

    const wrappers = getCodeBlockWrappers(wrapper)
    expect(wrappers.length).toBe(1)

    wrapper.unmount()

    // 卸载后 document 中不应残留 .code-block-wrapper 元素
    expect(document.querySelectorAll('.code-block-wrapper').length).toBe(0)
  })

  it('组件卸载后 contentStableTimer 应被清除', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '```js\nconst x = 1;\n```' },
      global: { stubs: globalStubs }
    })

    const component = wrapper.vm as any

    await wrapper.setProps({ content: '```js\nconst x = 1;\n```\n追加文字' })
    // 触发 watch → scheduleRender → setTimeout(contentStableTimer)
    expect(component.contentStableTimer).toBeTruthy()

    wrapper.unmount()

    // 卸载后 contentStableTimer 应被清除
    expect(component.contentStableTimer).toBeNull()
  })

  it('组件卸载后 RAF 定时器应被取消', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '初始内容' },
      global: { stubs: globalStubs }
    })

    await wrapper.setProps({ content: '变更内容' })

    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')

    wrapper.unmount()

    expect(cancelSpy).toHaveBeenCalled()
  })

  it('多次挂载/卸载循环不应累积 DOM 节点', async () => {
    const content = '```js\nconst y = 2;\n```'

    for (let i = 0; i < 5; i++) {
      const wrapper = mount(MarkdownRenderer, {
        props: { content },
        global: { stubs: globalStubs }
      })
      const wrappers = getCodeBlockWrappers(wrapper)
      expect(wrappers.length).toBe(1)
      wrapper.unmount()
    }

    // 如果没有内存泄漏，5 次循环后不应有残留 DOM
    expect(document.querySelectorAll('.code-block-wrapper').length).toBe(0)
  })
})

// ================================================================
// 测试11: SSR 水合
// ================================================================
describe('测试11: SSR 水合兼容性', () => {
  it('requestAnimationFrame 不存在时组件不应崩溃', () => {
    const originalRAF = window.requestAnimationFrame
    const originalCAF = window.cancelAnimationFrame

    // @ts-expect-error 模拟 SSR 环境
    delete window.requestAnimationFrame
    // @ts-expect-error
    delete window.cancelAnimationFrame

    expect(() => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '测试内容' },
        global: { stubs: globalStubs }
      })
      wrapper.unmount()
    }).not.toThrow()

    window.requestAnimationFrame = originalRAF
    window.cancelAnimationFrame = originalCAF
  })

  it('segments 在组件挂载后应正确填充', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '# 标题\n\n段落文字' },
      global: { stubs: globalStubs }
    })

    const component = wrapper.vm as any
    // segments 应包含至少一个 text 类型的片段
    expect(component.segments.length).toBeGreaterThanOrEqual(1)
    expect(component.segments[0].type).toBe('text')

    const container = getContainer(wrapper)
    expect(container.textContent).toContain('标题')
    expect(container.textContent).toContain('段落文字')
  })

  it('onMounted 中 doRender 应正确渲染代码块', () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '```js\nconst x = 1;\n```' },
      global: { stubs: globalStubs }
    })

    const wrappers = getCodeBlockWrappers(wrapper)

    // onMounted 在客户端执行，代码块应被渲染为 .code-block-wrapper
    expect(wrappers.length).toBe(1)
  })
})

// ================================================================
// 测试12: 压力测试
// ================================================================
describe('测试12: 压力测试（长文本+多代码块）', () => {
  beforeEach(setupRafMock)
  afterEach(restoreRafMock)

  it('10 个代码块 + 100 次 token 追加：所有代码块 DOM 引用不变', async () => {
    const baseContent = generateLongContent(10, '## 压力测试\n\n')
    const wrapper = mount(MarkdownRenderer, {
      props: { content: baseContent },
      global: { stubs: globalStubs }
    })

    const originalEls = getCodeBlockWrappers(wrapper)
    expect(originalEls.length).toBe(10)

    for (let i = 0; i < 100; i++) {
      await wrapper.setProps({
        content: `${baseContent}\n追加token${i}`
      })
    }
    await flushRafAndTick()

    const finalEls = getCodeBlockWrappers(wrapper)
    expect(finalEls.length).toBe(10)

    for (let i = 0; i < 10; i++) {
      expect(finalEls[i]).toBe(originalEls[i])
    }
  })

  it('100 次 token 追加只触发 1 次 renderMarkdown', async () => {
    const renderMarkdownSpy = vi.spyOn(
      await import('~/utils/markdown'),
      'renderMarkdown'
    )

    const baseContent = generateLongContent(5, '## 性能测试\n\n')
    const wrapper = mount(MarkdownRenderer, {
      props: { content: baseContent },
      global: { stubs: globalStubs }
    })

    const callsBefore = renderMarkdownSpy.mock.calls.length

    for (let i = 0; i < 100; i++) {
      await wrapper.setProps({
        content: `${baseContent}\n追加token${i}`
      })
    }
    await flushRafAndTick()

    expect(renderMarkdownSpy.mock.calls.length).toBe(callsBefore + 1)

    renderMarkdownSpy.mockRestore()
  })

  it('频繁切换 content（模拟快速打字）不应崩溃', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '' },
      global: { stubs: globalStubs }
    })

    for (let i = 0; i < 200; i++) {
      await wrapper.setProps({
        content: `第${i}次更新，内容长度${i * 10}`
      })
    }
    await flushRafAndTick()

    const container = getContainer(wrapper)
    expect(container.textContent).toContain('第199次更新')
  })

  it('大量公式 + 大量代码块混合内容渲染不崩溃', async () => {
    const formulas = Array.from(
      { length: 20 },
      (_, i) => `公式${i}: $E=mc^${i}$`
    ).join('\n')

    const codeBlocks = Array.from(
      { length: 10 },
      (_, i) => `\n\`\`\`js\nconst x${i} = ${i};\n\`\`\``
    ).join('\n')

    const content = `## 混合压力测试\n\n${formulas}\n${codeBlocks}`

    const wrapper = mount(MarkdownRenderer, {
      props: { content },
      global: { stubs: globalStubs }
    })

    const wrappers = getCodeBlockWrappers(wrapper)
    expect(wrappers.length).toBe(10)

    const container = getContainer(wrapper)
    expect(container.querySelectorAll('.math-inline').length).toBeGreaterThanOrEqual(20)
  })
})
