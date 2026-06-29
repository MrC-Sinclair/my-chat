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

  it('应正确渲染 Markdown 图片语法', () => {
    const html = renderMarkdown('![示例图片](https://example.com/image.png)')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/image.png"')
    expect(html).toContain('alt="示例图片"')
    expect(html).toContain('referrerpolicy="no-referrer"')
    expect(html).toContain('loading="lazy"')
  })

  it('应保留 img 标签的 src 和 alt 属性', () => {
    const html = renderMarkdown('<img src="https://example.com/photo.jpg" alt="照片">')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/photo.jpg"')
    expect(html).toContain('alt="照片"')
    expect(html).toContain('referrerpolicy="no-referrer"')
  })

  it('应过滤 img 标签的危险属性但保留 src', () => {
    const html = renderMarkdown(
      '<img src="https://example.com/img.png" onerror="alert(1)" onload="track()">'
    )
    expect(html).toContain('src="https://example.com/img.png"')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('onload')
  })

  it('应支持带 title 的图片', () => {
    const html = renderMarkdown('![图片](https://example.com/img.png "图片标题")')
    expect(html).toContain('src="https://example.com/img.png"')
    expect(html).toContain('title="图片标题"')
  })

  // ===== 边界场景测试 =====

  it('不应提取代码块内的 $$ 公式', () => {
    const md = '```latex\n$$E=mc^2$$\n```'
    const html = renderMarkdown(md)
    // 代码块内的 $$ 不应被当作公式提取
    expect(html).not.toContain('class="math-block"')
    expect(html).toContain('<pre')
    expect(html).toContain('$$E=mc^2$$')
  })

  it('不应提取代码块内的 $ 行内公式', () => {
    const md = '```python\n# 价格 $x = 5$\nprint(x)\n```'
    const html = renderMarkdown(md)
    expect(html).not.toContain('class="math-inline"')
    expect(html).toContain('<pre')
    expect(html).toContain('$x = 5$')
  })

  it('代码块内外公式应分别处理', () => {
    const md = '公式 $a+b$ 在代码外\n\n```latex\n$$x^2$$\n```\n\n公式 $$y^2$$ 在代码外'
    const html = renderMarkdown(md)
    // 代码外的公式应被提取
    expect(html).toContain('class="math-inline"')
    expect(html).toContain('class="math-block"')
    // 代码块内应有原始 $$ 文本
    expect(html).toContain('$$x^2$$')
  })

  it('不完整的 $$ 公式应渲染为骨架屏占位（流式 FOUC 修复）', () => {
    const html = renderMarkdown('这是一个不完整的公式 $$\\int_0^1 f(x)')
    // 未闭合的 $$ 用骨架屏占位，避免流式输出时暴露 LaTeX 源码字符
    expect(html).toContain('class="math-block"')
    expect(html).toContain('data-pending="true"')
    expect(html).toContain('math-block-placeholder')
    // 不应直接暴露 LaTeX 源码字符
    expect(html).not.toContain('$$\\int_0')
    expect(html).not.toContain('\\int_0^1')
  })

  it('空代码块应正常渲染', () => {
    const md = '```\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('<pre')
    expect(html).toContain('<code')
  })

  it('无语言标记的代码块应正常渲染', () => {
    const md = '```\nconsole.log("hello")\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('<pre')
    expect(html).toContain('console.log')
  })

  it('连续多个代码块应全部渲染', () => {
    const md = '```js\nconst a = 1\n```\n\n```python\nb = 2\n```\n\n```ts\nc = 3\n```'
    const html = renderMarkdown(md)
    const codeBlocks = html.match(/<pre>/g)
    expect(codeBlocks).toHaveLength(3)
    expect(html).toContain('const a = 1')
    expect(html).toContain('b = 2')
    expect(html).toContain('c = 3')
  })

  it('混合内容（代码块+公式+表格）应正确渲染', () => {
    const md =
      '行内公式 $E=mc^2$\n\n```python\nprint("hello")\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n块级公式 $$\\int_0^1 x dx$$'
    const html = renderMarkdown(md)
    expect(html).toContain('class="math-inline"')
    expect(html).toContain('class="math-block"')
    expect(html).toContain('<pre')
    expect(html).toContain('<table')
  })

  // ===== 全面组合测试 =====

  describe('公式与列表组合', () => {
    it('列表项中包含行内公式', () => {
      const md = '- 方程 $x^2=4$\n- 不等式 $y>0$'
      const html = renderMarkdown(md)
      expect(html).toContain('<ul')
      expect(html).toContain('class="math-inline"')
      expect(html).toContain('x^2=4')
      expect(html).toContain('y&gt;0')
    })

    it('有序列表项中包含行内公式', () => {
      const md = '1. 第一步 $a+b$\n2. 第二步 $c+d$'
      const html = renderMarkdown(md)
      expect(html).toContain('<ol')
      expect(html).toContain('class="math-inline"')
    })

    it('列表项后跟块级公式', () => {
      const md = '- 项目一\n- 项目二\n\n$$E=mc^2$$'
      const html = renderMarkdown(md)
      expect(html).toContain('<ul')
      expect(html).toContain('class="math-block"')
    })
  })

  describe('公式与表格组合', () => {
    it('表格单元格中包含行内公式', () => {
      const md = '| 公式 | 说明 |\n|---|---|\n| $x^2$ | 平方 |'
      const html = renderMarkdown(md)
      expect(html).toContain('<table')
      expect(html).toContain('class="math-inline"')
      expect(html).toContain('x^2')
    })

    it('表格后跟块级公式', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |\n\n$$\\sum_{i=1}^n i$$'
      const html = renderMarkdown(md)
      expect(html).toContain('<table')
      expect(html).toContain('class="math-block"')
    })
  })

  describe('公式与引用块组合', () => {
    it('引用块中包含行内公式', () => {
      const md = '> 爱因斯坦提出了 $E=mc^2$'
      const html = renderMarkdown(md)
      expect(html).toContain('<blockquote')
      expect(html).toContain('class="math-inline"')
    })

    it('引用块后跟块级公式', () => {
      const md = '> 引用文字\n\n$$\\int_0^1 x dx$$'
      const html = renderMarkdown(md)
      expect(html).toContain('<blockquote')
      expect(html).toContain('class="math-block"')
    })
  })

  describe('公式与标题组合', () => {
    it('标题中包含行内公式', () => {
      const md = '## 关于 $x^2$ 的讨论'
      const html = renderMarkdown(md)
      expect(html).toContain('<h2')
      expect(html).toContain('class="math-inline"')
    })

    it('标题后跟块级公式', () => {
      const md = '## 公式\n\n$$\\pi = 3.14$$'
      const html = renderMarkdown(md)
      expect(html).toContain('<h2')
      expect(html).toContain('class="math-block"')
    })
  })

  describe('行内代码与公式区分', () => {
    it('行内代码 `code` 不应被当作公式', () => {
      const md = '变量 `x` 的值'
      const html = renderMarkdown(md)
      expect(html).toContain('<code>x</code>')
      expect(html).not.toContain('class="math-inline"')
    })

    it('行内代码中的 $ 不应被当作公式', () => {
      const md = 'Shell 变量 `$HOME` 路径'
      const html = renderMarkdown(md)
      expect(html).toContain('<code>$HOME</code>')
      expect(html).not.toContain('class="math-inline"')
    })

    it('行内代码与公式共存', () => {
      const md = '使用 `numpy` 计算 $\\sum x_i$'
      const html = renderMarkdown(md)
      expect(html).toContain('<code>numpy</code>')
      expect(html).toContain('class="math-inline"')
    })
  })

  describe('公式特殊字符', () => {
    it('公式中含有 < > & 字符', () => {
      const md = '$a < b$ 和 $c > d$ 以及 $x & y$'
      const html = renderMarkdown(md)
      expect(html).toContain('class="math-inline"')
      // data-formula 中应保留原始字符
      expect(html).toContain('a &lt; b')
      expect(html).toContain('c &gt; d')
    })

    it('块级公式含多行内容', () => {
      const md = '$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$'
      const html = renderMarkdown(md)
      expect(html).toContain('class="math-block"')
    })

    it('连续多个行内公式', () => {
      const md = '$a$ 加 $b$ 等于 $c$'
      const html = renderMarkdown(md)
      const inlineCount = (html.match(/class="math-inline"/g) || []).length
      expect(inlineCount).toBe(3)
    })

    it('连续多个块级公式', () => {
      const md = '$$a$$\n\n$$b$$\n\n$$c$$'
      const html = renderMarkdown(md)
      const blockCount = (html.match(/class="math-block"/g) || []).length
      expect(blockCount).toBe(3)
    })
  })

  describe('代码块特殊场景', () => {
    it('代码块中含有 HTML 标签', () => {
      const md = '```html\n<div class="app">Hello</div>\n```'
      const html = renderMarkdown(md)
      expect(html).toContain('<pre')
      expect(html).toContain('language-html')
    })

    it('Mermaid 代码块应正常渲染', () => {
      const md = '```mermaid\ngraph LR\n  A-->B\n```'
      const html = renderMarkdown(md)
      expect(html).toContain('<pre')
      expect(html).toContain('language-mermaid')
    })

    it('代码块后紧跟公式（无空行）', () => {
      const md = '```js\nconst x = 1\n```\n$$x=1$$'
      const html = renderMarkdown(md)
      expect(html).toContain('<pre')
      expect(html).toContain('class="math-block"')
    })

    it('波浪号围栏代码块', () => {
      const md = '~~~python\nprint("hello")\n~~~'
      const html = renderMarkdown(md)
      expect(html).toContain('<pre')
      expect(html).toContain('language-python')
    })
  })

  describe('GFM 扩展语法', () => {
    it('删除线', () => {
      const html = renderMarkdown('~~删除线~~')
      expect(html).toContain('<del>删除线</del>')
    })

    it('任务列表', () => {
      const md = '- [x] 已完成\n- [ ] 未完成'
      const html = renderMarkdown(md)
      expect(html).toContain('已完成')
      expect(html).toContain('未完成')
    })

    it('嵌套列表', () => {
      const md = '- 一级\n  - 二级\n    - 三级'
      const html = renderMarkdown(md)
      expect(html).toContain('一级')
      expect(html).toContain('二级')
      expect(html).toContain('三级')
    })
  })

  describe('标题级别', () => {
    it('h1 到 h4', () => {
      const md = '# 一级\n## 二级\n### 三级\n#### 四级'
      const html = renderMarkdown(md)
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('<h3')
      expect(html).toContain('<h4')
    })
  })

  describe('水平线', () => {
    it('--- 应渲染为水平线', () => {
      const html = renderMarkdown('上面\n\n---\n\n下面')
      expect(html).toContain('<hr')
    })
  })

  describe('复杂组合场景', () => {
    it('完整文档：标题+列表+代码+公式+表格+引用', () => {
      const md = `# 数学笔记

## 基础公式

- 行内公式 $E=mc^2$
- 块级公式：

$$\\int_0^1 x dx = \\frac{1}{2}$$

## 代码示例

\`\`\`python
import numpy as np
x = np.array([1, 2, 3])
\`\`\`

## 数据表格

| 变量 | 值 |
|---|---|
| $x$ | 1 |
| $y$ | 2 |

> 引用：$a^2 + b^2 = c^2$

---

结束。`
      const html = renderMarkdown(md)
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('<ul')
      expect(html).toContain('class="math-inline"')
      expect(html).toContain('class="math-block"')
      expect(html).toContain('<pre')
      expect(html).toContain('<table')
      expect(html).toContain('<blockquote')
      expect(html).toContain('<hr')
    })

    it('代码块中含 $ 但代码外也有公式', () => {
      const md = '价格 $100$ 元\n\n```bash\necho "cost: $50"\n```'
      const html = renderMarkdown(md)
      // 代码外的 $100$ 应被当作公式
      expect(html).toContain('class="math-inline"')
      // 代码块内的 $50 不应被当作公式
      expect(html).toContain('<pre')
    })

    it('引用块中包含代码块', () => {
      const md = '> 引用文字\n>\n> ```\n> code\n> ```'
      const html = renderMarkdown(md)
      expect(html).toContain('<blockquote')
    })

    it('引用块中包含表格，表格中包含公式（三层嵌套）', () => {
      const md = '> | 公式 | 值 |\n> |---|---|\n> | $x^2$ | 4 |\n> | $y^2$ | 9 |'
      const html = renderMarkdown(md)
      expect(html).toContain('<blockquote')
      expect(html).toContain('<table')
      const inlineCount = (html.match(/class="math-inline"/g) || []).length
      expect(inlineCount).toBe(2)
    })

    it('列表后跟代码块，代码块中含 $$ 符号', () => {
      const md = '- 第一项\n- 第二项\n\n```python\n# 公式 $$x=1$$\nx = 1\n```\n\n- 第三项 $a+b$'
      const html = renderMarkdown(md)
      expect(html).toContain('<ul')
      expect(html).toContain('<pre')
      // 代码块内的 $$x=1$$ 应原样保留（$$ 被 HTML 实体编码）
      expect(html).toContain('$$x=1$$')
      // 列表项中的公式应正常渲染
      expect(html).toContain('class="math-inline"')
    })

    it('表格单元格中含行内代码，行内代码含 $ 符号', () => {
      const md =
        '| 命令 | 说明 |\n|---|---|\n| `echo $HOME` | 输出家目录 |\n| `ls $PATH` | 列出路径 |'
      const html = renderMarkdown(md)
      expect(html).toContain('<code>echo $HOME</code>')
      expect(html).toContain('<code>ls $PATH</code>')
      expect(html).not.toContain('class="math-inline"')
    })

    it('代码块中含 $$ + 代码块外有公式（内外隔离）', () => {
      const md = '外面公式 $a+b$\n\n```latex\n$$E=mc^2$$\n```\n\n外面公式 $$x^2$$'
      const html = renderMarkdown(md)
      expect(html).toContain('$$E=mc^2$$')
      expect(html).toContain('class="math-inline"')
      expect(html).toContain('class="math-block"')
    })
  })
})
