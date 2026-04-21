import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '~/utils/markdown'

describe('renderMarkdown', () => {
  it('应正确渲染纯文本段落', () => {
    const html = renderMarkdown('这是一段普通文本')
    expect(html).toContain('这是一段普通文本')
    expect(html).toContain('<p')
  })

  it('应正确渲染块级数学公式（$$...$$）', () => {
    const html = renderMarkdown('解方程 $$x^2+1=0$$')
    expect(html).toContain('class="math-block"')
    expect(html).toContain('x^2+1=0')
    expect(html).toContain('data-formula=')
  })

  it('应正确渲染行内数学公式（$...$）', () => {
    const html = renderMarkdown('解方程 $x^2+1=0$ 的根是虚数')
    expect(html).toContain('class="math-inline"')
    expect(html).toContain('x^2+1=0')
  })

  it('应同时支持块级和行内公式混合', () => {
    const html = renderMarkdown('行内 $a+b$ 和块级 $$\\int_0^1 x dx$$')
    expect(html).toContain('class="math-inline"')
    expect(html).toContain('class="math-block"')
  })

  it('应过滤XSS攻击脚本标签', () => {
    const html = renderMarkdown('<script>alert("xss")</script>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert')
  })

  it('应过滤事件处理器XSS攻击', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  it('应正确渲染代码块（```）', () => {
    const md = '```python\nprint("hello")\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('<pre')
    expect(html).toContain('<code')
    expect(html).toContain('print')
    expect(html).toContain('language-python')
  })

  it('应正确渲染表格', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    const html = renderMarkdown(md)
    expect(html).toContain('<table')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('应正确渲染有序列表', () => {
    const html = renderMarkdown('1. 第一项\n2. 第二项\n3. 第三项')
    expect(html).toContain('<ol')
    expect(html).toContain('第一项')
    expect(html).toContain('第二项')
    expect(html).toContain('第三项')
  })

  it('应正确渲染无序列表', () => {
    const html = renderMarkdown('- 苹果\n- 香蕉\n- 橙子')
    expect(html).toContain('<ul')
    expect(html).toContain('苹果')
    expect(html).toContain('香蕉')
  })

  it('应正确渲染引用块（blockquote）', () => {
    const html = renderMarkdown('> 这是一段引用文字')
    expect(html).toContain('<blockquote')
    expect(html).toContain('这是一段引用文字')
  })

  it('应正确渲染粗体和斜体', () => {
    const html = renderMarkdown('这是**粗体**和*斜体*文本')
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<em>斜体</em>')
  })

  it('应正确处理空字符串输入', () => {
    const html = renderMarkdown('')
    expect(html).toBe('')
  })

  it('应保留链接但进行安全处理', () => {
    const html = renderMarkdown('[点击这里](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('点击这里')
  })
})
