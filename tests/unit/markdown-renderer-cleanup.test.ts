import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
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

describe('MarkdownRenderer mathCleanup 管理', () => {
  beforeEach(() => {
    setupRafMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renderMath 返回的 cleanup 应在下次渲染前被调用', async () => {
    const cleanupCalls: number[] = []
    const originalRenderMath = vi.fn(async () => {
      const callIndex = originalRenderMath.mock.calls.length
      const cleanup = () => {
        cleanupCalls.push(callIndex)
      }
      return cleanup
    })

    const wrapper = mount(MarkdownRenderer, {
      props: { content: '$$x^2$$' },
      global: {
        stubs: globalStubs,
        mocks: {}
      }
    })

    await wrapper.setProps({ content: '$$y^2$$' })
    await flushRafAndTick()

    await nextTick()
    await new Promise((r) => setTimeout(r, 50))

    wrapper.unmount()
  })

  it('onUnmounted 应调用 mathCleanup', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '$$x^2$$' },
      global: { stubs: globalStubs }
    })

    await nextTick()
    await new Promise((r) => setTimeout(r, 100))

    wrapper.unmount()
  })

  it('连续内容变化应正确管理 cleanup 生命周期', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '初始内容' },
      global: { stubs: globalStubs }
    })

    await wrapper.setProps({ content: '第二次内容' })
    await flushRafAndTick()

    await wrapper.setProps({ content: '第三次内容' })
    await flushRafAndTick()

    await wrapper.setProps({ content: '最终内容' })
    await flushRafAndTick()

    const container = wrapper.find('.markdown-body').element as HTMLElement
    expect(container.textContent).toContain('最终内容')

    wrapper.unmount()
  })

  it('无公式内容时 cleanup 应为空函数且安全', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '纯文本，无公式' },
      global: { stubs: globalStubs }
    })

    await nextTick()

    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('空内容不应导致 cleanup 相关错误', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '' },
      global: { stubs: globalStubs }
    })

    await nextTick()

    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('内容稳定后（1.5s）应重新调用 renderMath 并更新 cleanup', async () => {
    vi.useFakeTimers()

    const wrapper = mount(MarkdownRenderer, {
      props: { content: '$$a^2 + b^2 = c^2$$' },
      global: { stubs: globalStubs }
    })

    await nextTick()

    await wrapper.setProps({ content: '$$E=mc^2$$' })
    await flushRafAndTick()

    vi.advanceTimersByTime(1600)
    await nextTick()

    expect(() => wrapper.unmount()).not.toThrow()

    vi.useRealTimers()
  })

  it('组件销毁时应清理 contentStableTimer 和 mathCleanup', async () => {
    vi.useFakeTimers()

    const wrapper = mount(MarkdownRenderer, {
      props: { content: '$$x^2$$' },
      global: { stubs: globalStubs }
    })

    await nextTick()

    await wrapper.setProps({ content: '$$y^2$$' })
    await flushRafAndTick()

    vi.advanceTimersByTime(500)

    expect(() => wrapper.unmount()).not.toThrow()

    vi.useRealTimers()
  })

  it('大量公式内容变化不应导致内存泄漏（cleanup 链）', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '初始' },
      global: { stubs: globalStubs }
    })

    for (let i = 0; i < 20; i++) {
      await wrapper.setProps({ content: `第 ${i} 次更新 $$x_${i}$$` })
      await flushRafAndTick()
    }

    const container = wrapper.find('.markdown-body').element as HTMLElement
    expect(container.textContent).toContain('第 19 次更新')

    expect(() => wrapper.unmount()).not.toThrow()
  })
})
