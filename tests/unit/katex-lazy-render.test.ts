import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderMath } from '~/utils/katex'

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

describe('KaTeX IntersectionObserver 延迟渲染', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    MockIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    container.remove()
  })

  it('公式数量 ≤ 5 时应全量渲染，不创建 IntersectionObserver', async () => {
    let html = ''
    for (let i = 0; i < 5; i++) {
      html += `<span class="math-inline" data-formula="x_${i}">x_${i}</span>\n`
    }
    container.innerHTML = html
    const cleanup = await renderMath(container)
    expect(MockIntersectionObserver.instances.length).toBe(0)
    const rendered = container.querySelectorAll('.math-inline')
    rendered.forEach((el) => {
      expect(el.innerHTML).toContain('katex')
      expect(el.hasAttribute('data-katex-rendered')).toBe(true)
    })
    expect(typeof cleanup).toBe('function')
  })

  it('公式数量 > 5 时应创建 IntersectionObserver', async () => {
    let html = ''
    for (let i = 0; i < 8; i++) {
      html += `<span class="math-inline" data-formula="y_${i}">y_${i}</span>\n`
    }
    container.innerHTML = html

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

    const cleanup = await renderMath(container)
    expect(MockIntersectionObserver.instances.length).toBe(1)
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('视口内的公式应立即渲染，视口外的应被 observe', async () => {
    const html = `
      <span class="math-inline" data-formula="a_1">a1</span>
      <span class="math-inline" data-formula="a_2">a2</span>
      <span class="math-inline" data-formula="a_3">a3</span>
      <span class="math-inline" data-formula="a_4">a4</span>
      <span class="math-inline" data-formula="a_5">a5</span>
      <span class="math-inline" data-formula="a_6">a6</span>
    `
    container.innerHTML = html

    let callIndex = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      callIndex++
      const isVisible = callIndex <= 3
      return {
        top: isVisible ? 100 : -9999,
        bottom: isVisible ? 130 : -9000,
        left: 0,
        right: 0,
        width: 100,
        height: 30,
        x: 0,
        y: isVisible ? 100 : -9999,
        toJSON: () => ({})
      } as DOMRect
    })

    const cleanup = await renderMath(container)

    const rendered = container.querySelectorAll('[data-katex-rendered]')
    expect(rendered.length).toBe(3)

    const observer = MockIntersectionObserver.instances[0]
    expect(observer).toBeTruthy()
    expect(observer!.observe).toHaveBeenCalled()

    cleanup()
  })

  it('cleanup 函数应断开 IntersectionObserver', async () => {
    let html = ''
    for (let i = 0; i < 8; i++) {
      html += `<span class="math-inline" data-formula="z_${i}">z_${i}</span>\n`
    }
    container.innerHTML = html

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

    const cleanup = await renderMath(container)
    const observer = MockIntersectionObserver.instances[0]
    expect(observer).toBeTruthy()

    cleanup()
    expect(observer!.disconnect).toHaveBeenCalled()
  })

  it('已渲染的公式不应重复渲染（data-katex-rendered 属性）', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="x^2">x^2</span>'
    await renderMath(container)
    const el = container.querySelector('.math-inline')!
    expect(el.hasAttribute('data-katex-rendered')).toBe(true)
    const firstHtml = el.innerHTML

    const cleanup = await renderMath(container)
    expect(el.innerHTML).toBe(firstHtml)
    cleanup()
  })

  it('renderMath 返回的 cleanup 在无 observer 时也应可安全调用', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="a+b">a+b</span>'
    const cleanup = await renderMath(container)
    expect(() => cleanup()).not.toThrow()
  })

  it('SSR 环境（无 window）应返回空 cleanup 函数', async () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      container.innerHTML = '<div class="math-block" data-formula="x^2">x^2</div>'
      const cleanup = await renderMath(container)
      expect(typeof cleanup).toBe('function')
      expect(() => cleanup()).not.toThrow()
    } finally {
      vi.stubGlobal('window', originalWindow)
    }
  })

  it('空容器应返回空 cleanup 函数且不创建 observer', async () => {
    container.innerHTML = ''
    const cleanup = await renderMath(container)
    expect(typeof cleanup).toBe('function')
    expect(MockIntersectionObserver.instances.length).toBe(0)
  })

  it('所有公式已渲染时应返回空 cleanup 且不创建 observer', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="x" data-katex-rendered="true">x</span>'
    const cleanup = await renderMath(container)
    expect(typeof cleanup).toBe('function')
    expect(MockIntersectionObserver.instances.length).toBe(0)
  })

  it('IntersectionObserver 回调触发时应渲染公式并 unobserve', async () => {
    let html = ''
    for (let i = 0; i < 8; i++) {
      html += `<span class="math-inline" data-formula="m_${i}">m_${i}</span>\n`
    }
    container.innerHTML = html

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

    const cleanup = await renderMath(container)

    const observer = MockIntersectionObserver.instances[0]
    expect(observer).toBeTruthy()

    const unrendered = container.querySelectorAll('.math-inline:not([data-katex-rendered])')
    expect(unrendered.length).toBeGreaterThan(0)

    const target = unrendered[0]
    observer!.callback(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver
    )

    expect(target.hasAttribute('data-katex-rendered')).toBe(true)
    expect((target as HTMLElement).innerHTML).toContain('katex')
    expect(observer!.unobserve).toHaveBeenCalledWith(target)

    cleanup()
  })

  it('renderSingleFormula 对块级公式应添加 katex-display 类', async () => {
    container.innerHTML = '<div class="math-block" data-formula="E=mc^2">E=mc^2</div>'
    await renderMath(container)
    const el = container.querySelector('.math-block')!
    expect(el.classList.contains('katex-display')).toBe(true)
    expect(el.hasAttribute('data-katex-rendered')).toBe(true)
  })

  it('renderSingleFormula 对行内公式不应添加 katex-display 类', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="E=mc^2">E=mc^2</span>'
    await renderMath(container)
    const el = container.querySelector('.math-inline')!
    expect(el.classList.contains('katex-display')).toBe(false)
    expect(el.hasAttribute('data-katex-rendered')).toBe(true)
  })

  it('无效公式应标记为已渲染但不崩溃', async () => {
    container.innerHTML = '<div class="math-block" data-formula="\\invalid{">无效</div>'
    await expect(renderMath(container)).resolves.not.toThrow()
    const el = container.querySelector('.math-block')!
    expect(el.hasAttribute('data-katex-rendered')).toBe(true)
  })

  it('阈值边界：恰好 5 个公式应全量渲染', async () => {
    let html = ''
    for (let i = 0; i < 5; i++) {
      html += `<span class="math-inline" data-formula="t_${i}">t_${i}</span>\n`
    }
    container.innerHTML = html
    const cleanup = await renderMath(container)
    expect(MockIntersectionObserver.instances.length).toBe(0)
    const rendered = container.querySelectorAll('[data-katex-rendered]')
    expect(rendered.length).toBe(5)
    cleanup()
  })

  it('阈值边界：恰好 6 个公式应使用 IntersectionObserver', async () => {
    let html = ''
    for (let i = 0; i < 6; i++) {
      html += `<span class="math-inline" data-formula="s_${i}">s_${i}</span>\n`
    }
    container.innerHTML = html

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 130,
      left: 0,
      right: 100,
      width: 100,
      height: 30,
      x: 0,
      y: 100,
      toJSON: () => ({})
    } as DOMRect)

    const cleanup = await renderMath(container)
    expect(MockIntersectionObserver.instances.length).toBe(1)
    cleanup()
  })

  it('多次调用 renderMath 应正确管理 cleanup', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="a">a</span>'
    const cleanup1 = await renderMath(container)

    container.innerHTML = '<span class="math-inline" data-formula="b">b</span>'
    const cleanup2 = await renderMath(container)

    expect(() => cleanup1()).not.toThrow()
    expect(() => cleanup2()).not.toThrow()
  })

  it('视口边界：公式在视口上方 200px 内应立即渲染', async () => {
    let html = ''
    for (let i = 0; i < 8; i++) {
      html += `<span class="math-inline" data-formula="v_${i}">v_${i}</span>\n`
    }
    container.innerHTML = html

    let callIdx = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      callIdx++
      const nearTop = callIdx === 1
      return {
        top: nearTop ? -150 : -9999,
        bottom: nearTop ? -120 : -9000,
        left: 0,
        right: 100,
        width: 100,
        height: 30,
        x: 0,
        y: nearTop ? -150 : -9999,
        toJSON: () => ({})
      } as DOMRect
    })

    const cleanup = await renderMath(container)
    const firstEl = container.querySelector('.math-inline')!
    expect(firstEl.hasAttribute('data-katex-rendered')).toBe(true)
    cleanup()
  })

  it('视口边界：公式在视口下方 200px 内应立即渲染', async () => {
    let html = ''
    for (let i = 0; i < 8; i++) {
      html += `<span class="math-inline" data-formula="w_${i}">w_${i}</span>\n`
    }
    container.innerHTML = html

    let callIdx = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      callIdx++
      const nearBottom = callIdx === 1
      return {
        top: nearBottom ? (window.innerHeight + 150) : -9999,
        bottom: nearBottom ? (window.innerHeight + 180) : -9000,
        left: 0,
        right: 100,
        width: 100,
        height: 30,
        x: 0,
        y: nearBottom ? (window.innerHeight + 150) : -9999,
        toJSON: () => ({})
      } as DOMRect
    })

    const cleanup = await renderMath(container)
    const firstEl = container.querySelector('.math-inline')!
    expect(firstEl.hasAttribute('data-katex-rendered')).toBe(true)
    cleanup()
  })

  it('data-formula 为空字符串时应使用 textContent 回退', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="">a+b</span>'
    const cleanup = await renderMath(container)
    const el = container.querySelector('.math-inline')!
    expect(el.hasAttribute('data-katex-rendered')).toBe(true)
    expect(el.innerHTML).toContain('katex')
    cleanup()
  })

  it('data-formula 和 textContent 都为空时应安全处理', async () => {
    container.innerHTML = '<span class="math-inline" data-formula=""></span>'
    const cleanup = await renderMath(container)
    const el = container.querySelector('.math-inline')!
    expect(el.hasAttribute('data-katex-rendered')).toBe(true)
    cleanup()
  })
})
