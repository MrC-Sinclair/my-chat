import { describe, it, expect, beforeEach } from 'vitest'
import { renderMath } from '~/utils/katex'

describe('renderMath', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('应正确渲染块级公式', () => {
    container.innerHTML = '<div class="math-block" data-formula="x^2+1=0">x^2+1=0</div>'
    renderMath(container)
    const mathBlock = container.querySelector('.math-block')
    expect(mathBlock).toBeTruthy()
    expect(mathBlock?.innerHTML).toContain('katex')
    expect(mathBlock?.classList.contains('katex-display')).toBe(true)
  })

  it('应正确渲染行内公式', () => {
    container.innerHTML = '<span class="math-inline" data-formula="E=mc^2">E=mc^2</span>'
    renderMath(container)
    const mathInline = container.querySelector('.math-inline')
    expect(mathInline).toBeTruthy()
    expect(mathInline?.innerHTML).toContain('katex')
  })

  it('应同时渲染多个块级和行内公式', () => {
    container.innerHTML = `
      <div class="math-block" data-formula="\\int_0^1 x dx">积分</div>
      <span class="math-inline" data-formula="a+b">加法</span>
      <div class="math-block" data-formula="\\sum_{i=1}^{n} i">求和</div>
    `
    renderMath(container)
    const blocks = container.querySelectorAll('.math-block')
    const inlines = container.querySelectorAll('.math-inline')
    expect(blocks.length).toBe(2)
    expect(inlines.length).toBe(1)
    blocks.forEach((block) => {
      expect(block.innerHTML).toContain('katex')
    })
    expect(inlines[0].innerHTML).toContain('katex')
  })

  it('缺少data-formula时应使用textContent作为回退', () => {
    container.innerHTML = '<div class="math-block">x+y=z</div>'
    renderMath(container)
    const mathBlock = container.querySelector('.math-block')
    expect(mathBlock?.innerHTML).toContain('katex')
  })

  it('空容器不应抛出错误', () => {
    container.innerHTML = ''
    expect(() => renderMath(container)).not.toThrow()
  })

  it('无公式的普通内容不应受影响', () => {
    container.innerHTML = '<p>这是一段普通文字，没有公式</p>'
    renderMath(container)
    expect(container.innerHTML).toContain('这是一段普通文字，没有公式')
  })

  it('无效公式不应导致崩溃（throwOnError: false）', () => {
    container.innerHTML = '<div class="math-block" data-formula="\\invalid{">无效公式</div>'
    expect(() => renderMath(container)).not.toThrow()
  })
})
