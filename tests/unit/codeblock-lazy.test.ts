import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import CodeBlock from '~/components/chat/CodeBlock.vue'

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  static instances: MockIntersectionObserver[] = []

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    MockIntersectionObserver.instances.push(this)
  }

  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn().mockReturnValue([])
}

describe('CodeBlock 懒加载', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountCodeBlock(props: { code: string; language?: string }) {
    return mount(CodeBlock, {
      props,
      attachTo: document.body,
      global: {
        directives: {
          tooltip: () => {}
        }
      }
    })
  }

  it('不可见时应显示骨架屏而非代码', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -9999,
      bottom: -9000,
      left: 0,
      right: 0,
      width: 100,
      height: 30,
      x: 0,
      y: -9999,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'console.log("hello")', language: 'javascript' })
    await wrapper.vm.$nextTick()

    const skeleton = wrapper.find('.animate-pulse')
    expect(skeleton.exists()).toBe(true)

    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(false)

    wrapper.unmount()
  })

  it('进入视口后应渲染代码', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 200,
      left: 0,
      right: 0,
      width: 100,
      height: 100,
      x: 0,
      y: 100,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'const x = 1', language: 'typescript' })
    await wrapper.vm.$nextTick()

    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)

    const code = wrapper.find('code')
    expect(code.exists()).toBe(true)
    expect(code.text()).toContain('const x = 1')

    wrapper.unmount()
  })

  it('onUnmounted 应断开 IntersectionObserver', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -9999,
      bottom: -9000,
      left: 0,
      right: 0,
      width: 100,
      height: 30,
      x: 0,
      y: -9999,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'test', language: 'text' })
    await wrapper.vm.$nextTick()

    expect(MockIntersectionObserver.instances.length).toBe(1)

    wrapper.unmount()
    expect(MockIntersectionObserver.instances[0].disconnect).toHaveBeenCalled()
  })

  it('空代码不应高亮', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 200,
      left: 0,
      right: 0,
      width: 100,
      height: 100,
      x: 0,
      y: 100,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: '', language: 'text' })
    await wrapper.vm.$nextTick()

    const pre = wrapper.find('pre')
    if (pre.exists()) {
      expect(pre.find('code').text()).toBe('')
    }

    wrapper.unmount()
  })

  it('无 language 时应自动检测', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 200,
      left: 0,
      right: 0,
      width: 100,
      height: 100,
      x: 0,
      y: 100,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'def hello():\n  pass' })
    await wrapper.vm.$nextTick()

    const code = wrapper.find('code')
    expect(code.exists()).toBe(true)
    expect(code.text()).toContain('def')

    wrapper.unmount()
  })

  it('复制按钮应正常工作', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 200,
      left: 0,
      right: 0,
      width: 100,
      height: 100,
      x: 0,
      y: 100,
      toJSON: () => ({})
    } as DOMRect)

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText }
    })

    const wrapper = mountCodeBlock({ code: 'copy me', language: 'text' })
    await wrapper.vm.$nextTick()

    const btn = wrapper.find('button')
    await btn.trigger('click')

    expect(writeText).toHaveBeenCalledWith('copy me')

    wrapper.unmount()
  })

  it('IntersectionObserver 回调触发后应切换到代码显示', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -9999,
      bottom: -9000,
      left: 0,
      right: 0,
      width: 100,
      height: 30,
      x: 0,
      y: -9999,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'hello world', language: 'text' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.animate-pulse').exists()).toBe(true)

    const observer = MockIntersectionObserver.instances[0]
    expect(observer).toBeTruthy()

    const wrapperEl = wrapper.find('.code-block-wrapper').element
    observer!.callback(
      [{ isIntersecting: true, target: wrapperEl } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.find('pre').exists()).toBe(true)
    expect(wrapper.find('.animate-pulse').exists()).toBe(false)

    wrapper.unmount()
  })

  it('视口上方 200px 内的代码块应立即渲染', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -150,
      bottom: -120,
      left: 0,
      right: 100,
      width: 100,
      height: 30,
      x: 0,
      y: -150,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'near top', language: 'text' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('pre').exists()).toBe(true)
    expect(MockIntersectionObserver.instances.length).toBe(0)

    wrapper.unmount()
  })

  it('视口下方 200px 内的代码块应立即渲染', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight + 150,
      bottom: window.innerHeight + 180,
      left: 0,
      right: 100,
      width: 100,
      height: 30,
      x: 0,
      y: window.innerHeight + 150,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'near bottom', language: 'text' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('pre').exists()).toBe(true)
    expect(MockIntersectionObserver.instances.length).toBe(0)

    wrapper.unmount()
  })

  it('远在视口外的代码块应使用 IntersectionObserver', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -9999,
      bottom: -9000,
      left: 0,
      right: 0,
      width: 100,
      height: 30,
      x: 0,
      y: -9999,
      toJSON: () => ({})
    } as DOMRect)

    const wrapper = mountCodeBlock({ code: 'far away', language: 'text' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
    expect(MockIntersectionObserver.instances.length).toBe(1)
    expect(MockIntersectionObserver.instances[0].observe).toHaveBeenCalled()

    wrapper.unmount()
  })
})
