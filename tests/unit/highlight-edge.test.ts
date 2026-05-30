import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hljs } from '~/utils/highlight'

describe('highlight.js 按需引入 - 边界测试', () => {
  it('已注册语言应能正常高亮', () => {
    const result = hljs.highlight('const x = 1;', { language: 'javascript' })
    expect(result.value).toContain('keyword')
    expect(result.language).toBe('javascript')
  })

  it('typescript 应能正常高亮', () => {
    const result = hljs.highlight('const x: number = 1;', { language: 'typescript' })
    expect(result.value).toBeTruthy()
    expect(result.language).toBe('typescript')
  })

  it('python 应能正常高亮', () => {
    const result = hljs.highlight('def hello():\n    pass', { language: 'python' })
    expect(result.value).toContain('keyword')
  })

  it('go 应能正常高亮', () => {
    const result = hljs.highlight('func main() {}', { language: 'go' })
    expect(result.value).toContain('keyword')
  })

  it('java 应能正常高亮', () => {
    const result = hljs.highlight('public class Main {}', { language: 'java' })
    expect(result.value).toContain('keyword')
  })

  it('bash 和 shell 别名都应可用', () => {
    const bashResult = hljs.highlight('echo hello', { language: 'bash' })
    const shellResult = hljs.highlight('echo hello', { language: 'shell' })
    expect(bashResult.value).toBeTruthy()
    expect(shellResult.value).toBeTruthy()
  })

  it('sql 应能正常高亮', () => {
    const result = hljs.highlight('SELECT * FROM users;', { language: 'sql' })
    expect(result.value).toContain('keyword')
  })

  it('json 应能正常高亮', () => {
    const result = hljs.highlight('{"key": "value"}', { language: 'json' })
    expect(result.value).toBeTruthy()
  })

  it('yaml 应能正常高亮', () => {
    const result = hljs.highlight('name: test', { language: 'yaml' })
    expect(result.value).toBeTruthy()
  })

  it('html 别名应映射到 xml', () => {
    const result = hljs.highlight('<div>hello</div>', { language: 'html' })
    expect(result.value).toBeTruthy()
  })

  it('css 应能正常高亮', () => {
    const result = hljs.highlight('.class { color: red; }', { language: 'css' })
    expect(result.value).toBeTruthy()
  })

  it('未注册语言（rust）调用 hljs.getLanguage 应返回 undefined', () => {
    const lang = hljs.getLanguage('rust')
    expect(lang).toBeUndefined()
  })

  it('未注册语言（c++）调用 hljs.getLanguage 应返回 undefined', () => {
    const lang = hljs.getLanguage('cpp')
    expect(lang).toBeUndefined()
  })

  it('未注册语言（ruby）调用 hljs.getLanguage 应返回 undefined', () => {
    const lang = hljs.getLanguage('ruby')
    expect(lang).toBeUndefined()
  })

  it('hljs.highlightAuto 应能对未注册语言自动检测', () => {
    const result = hljs.highlightAuto('fn main() { println!("hello"); }')
    expect(result.value).toBeTruthy()
  })

  it('hljs.highlight 对未注册语言应抛出错误（预期行为）', () => {
    expect(() => {
      hljs.highlight('fn main() {}', { language: 'rust' })
    }).toThrow()
  })

  it('空字符串应返回空字符串（不崩溃）', () => {
    const result = hljs.highlight('', { language: 'javascript' })
    expect(result.value).toBe('')
  })

  it('纯文本不应导致崩溃', () => {
    const result = hljs.highlightAuto('这是一段纯文本，没有代码')
    expect(result.value).toBeTruthy()
  })

  it('超长代码不应导致崩溃', () => {
    const longCode = 'const x = 1;\n'.repeat(1000)
    const result = hljs.highlight(longCode, { language: 'javascript' })
    expect(result.value).toBeTruthy()
  })
})
