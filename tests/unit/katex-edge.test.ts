import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderMath } from '~/utils/katex'

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn().mockReturnValue([])
}

describe('KaTeX 动态加载 - 边界测试', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('连续调用 renderMath 不应重复加载 KaTeX', async () => {
    container.innerHTML = '<div class="math-block" data-formula="x^2">x^2</div>'
    await renderMath(container)
    const firstInner = container.querySelector('.math-block')!.innerHTML

    container.innerHTML = '<div class="math-block" data-formula="y^2">y^2</div>'
    await renderMath(container)
    const secondInner = container.querySelector('.math-block')!.innerHTML

    expect(firstInner).toContain('katex')
    expect(secondInner).toContain('katex')
  })

  it('空 data-formula 属性应使用 textContent 回退', async () => {
    container.innerHTML = '<div class="math-block">a+b=c</div>'
    await renderMath(container)
    expect(container.querySelector('.math-block')?.innerHTML).toContain('katex')
  })

  it('data-formula 和 textContent 都为空时应渲染空公式', async () => {
    container.innerHTML = '<div class="math-block" data-formula=""></div>'
    await renderMath(container)
    const el = container.querySelector('.math-block')
    expect(el).toBeTruthy()
  })

  it('混合块级和行内公式应全部渲染', async () => {
    container.innerHTML = `
      <p>行内公式 <span class="math-inline" data-formula="E=mc^2">E=mc^2</span> 和块级公式</p>
      <div class="math-block" data-formula="\\int_0^1 x dx">积分</div>
      <p>另一个行内 <span class="math-inline" data-formula="a^2+b^2=c^2">a^2+b^2=c^2</span></p>
    `
    await renderMath(container)
    const blocks = container.querySelectorAll('.math-block')
    const inlines = container.querySelectorAll('.math-inline')
    expect(blocks.length).toBe(1)
    expect(inlines.length).toBe(2)
    blocks.forEach((b) => expect(b.innerHTML).toContain('katex'))
    inlines.forEach((i) => expect(i.innerHTML).toContain('katex'))
  })

  it('包含特殊字符的公式应正确渲染', async () => {
    container.innerHTML = '<span class="math-inline" data-formula="\\frac{1}{2} + \\sqrt{x}">公式</span>'
    await renderMath(container)
    expect(container.querySelector('.math-inline')?.innerHTML).toContain('katex')
  })

  it('无效 LaTeX 语法不应导致崩溃（throwOnError: false）', async () => {
    container.innerHTML = '<div class="math-block" data-formula="\\begin{aligned} \\end{">无效</div>'
    await expect(renderMath(container)).resolves.not.toThrow()
    const el = container.querySelector('.math-block')
    expect(el?.innerHTML).toContain('katex')
  })

  it('renderMath 在 SSR 环境（无 window）应直接返回', async () => {
    const originalWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      container.innerHTML = '<div class="math-block" data-formula="x^2">x^2</div>'
      await renderMath(container)
      expect(container.querySelector('.math-block')?.innerHTML).not.toContain('katex')
    } finally {
      vi.stubGlobal('window', originalWindow)
    }
  })

  it('大量公式批量渲染不应崩溃', async () => {
    let html = ''
    for (let i = 0; i < 50; i++) {
      html += `<span class="math-inline" data-formula="E=mc^${i}">公式${i}</span>\n`
    }
    container.innerHTML = html
    await expect(renderMath(container)).resolves.not.toThrow()
    const rendered = container.querySelectorAll('.math-inline')
    expect(rendered.length).toBe(50)
    rendered.forEach((el) => {
      expect(el.innerHTML).toContain('katex')
    })
  })
})
