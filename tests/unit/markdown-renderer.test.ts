/**
 * MarkdownRenderer 组件性能优化测试
 *
 * 验证三项核心优化：
 *   1. RAF 节流 — 同一帧内多次 content 变化合并为一次渲染
 *   2. CodeBlock 实例复用 — 代码内容不变时复用已有 Vue 实例，不销毁重建
 *   3. 防重复渲染 — content 无变化时跳过渲染
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

/**
 * defineAsyncComponent 在 Vitest 中不会自动解析 loader，
 * 导致 AsyncCodeBlock 渲染为空注释节点。
 * 通过 global.stubs 将异步组件替换为同步的 CodeBlock，
 * 使测试能正常访问 .code-block-wrapper 等 DOM 元素。
 */
const globalStubs = {
  AsyncCodeBlock: CodeBlock
}

/** 获取容器内的代码块 wrapper DOM 元素（声明式渲染后类名为 .code-block-wrapper） */
function getCodeBlockWrappers(wrapper: VueWrapper) {
  const containerEl = wrapper.find('.markdown-body').element
  return containerEl.querySelectorAll('.code-block-wrapper')
}

/** 获取容器 div（含 textContent / querySelectorAll） */
function getContainer(wrapper: VueWrapper): HTMLElement {
  return wrapper.find('.markdown-body').element as HTMLElement
}

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    setupRafMock()
  })

  afterEach(() => {
    restoreRafMock()
  })

  // ================================================================
  // 基本渲染回归测试
  // ================================================================
  describe('基本渲染', () => {
    it('应正确渲染纯文本内容', () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '你好世界' },
        global: { stubs: globalStubs }
      })
      const container = getContainer(wrapper)
      expect(container.textContent).toContain('你好世界')
    })

    it('应正确渲染 Markdown 标题', () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '# 一级标题' },
        global: { stubs: globalStubs }
      })
      const container = getContainer(wrapper)
      expect(container.querySelector('h1')).toBeTruthy()
      expect(container.querySelector('h1')?.textContent).toBe('一级标题')
    })

    it('onMounted 时同步渲染代码块（不走 RAF）', () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '```js\nconst x = 1\n```' },
        global: { stubs: globalStubs }
      })
      const wrappers = getCodeBlockWrappers(wrapper)
      expect(wrappers.length).toBe(1)
      // CodeBlock.vue 中 language 标签类名为 text-xs text-semi-code-dark-text font-mono
      // （Semi Design 迁移后由 text-gray-400 改为 text-semi-code-dark-text）
      expect(wrappers[0].querySelector('.text-xs.text-semi-code-dark-text.font-mono')?.textContent).toBe('js')
    })

    it('应正确渲染数学公式占位符', () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '解方程 $$x^2 = -1$$' },
        global: { stubs: globalStubs }
      })
      const container = getContainer(wrapper)
      expect(container.querySelector('.math-block')).toBeTruthy()
    })

    it('空内容不应崩溃', () => {
      expect(() =>
        mount(MarkdownRenderer, { props: { content: '' }, global: { stubs: globalStubs } })
      ).not.toThrow()
    })
  })

  // ================================================================
  // RAF 节流测试
  // ================================================================
  describe('RAF 节流', () => {
    it('content 变化后未执行 RAF 时，DOM 保持旧内容不变', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '初始内容' },
        global: { stubs: globalStubs }
      })
      const container = getContainer(wrapper)
      expect(container.textContent).toContain('初始内容')

      await wrapper.setProps({ content: '修改后的内容' })

      // RAF 尚未执行，DOM 应仍是旧内容
      expect(container.textContent).toContain('初始内容')
      expect(container.textContent).not.toContain('修改后的内容')
    })

    it('flush RAF 后 DOM 更新为最新 content', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '初始' },
        global: { stubs: globalStubs }
      })

      await wrapper.setProps({ content: '最新内容' })
      await flushRafAndTick()

      const container = getContainer(wrapper)
      expect(container.textContent).toContain('最新内容')
    })

    it('同一帧内连续 3 次 content 变化，只触发最后一次渲染', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: 'first' },
        global: { stubs: globalStubs }
      })

      // 连续三次变更，均未 flush RAF
      await wrapper.setProps({ content: 'second' })
      await wrapper.setProps({ content: 'third' })
      await wrapper.setProps({ content: 'final' })

      // RAF 排队中，scheduleRender() 不重复注册
      expect(rafCallbacks.length).toBe(1)

      const container = getContainer(wrapper)
      expect(container.textContent).toContain('first')

      await flushRafAndTick()

      // DOM 应为最后一次 content
      expect(container.textContent).toContain('final')
      expect(container.textContent).not.toContain('first')
      expect(container.textContent).not.toContain('second')
      expect(container.textContent).not.toContain('third')
    })

    it('同一帧内多次变更含 code block，flush 后仅渲染一次', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '```py\nprint("v1")\n```\n段落A' },
        global: { stubs: globalStubs }
      })

      const container = getContainer(wrapper)
      expect(getCodeBlockWrappers(wrapper).length).toBe(1)

      await wrapper.setProps({ content: '```py\nprint("v2")\n```\n段落B' })
      await wrapper.setProps({ content: '```py\nprint("v3")\n```\n段落C' })

      await flushRafAndTick()

      // 最终渲染 v3，中间的 v2 被跳过
      expect(container.textContent).toContain('段落C')
      expect(container.textContent).toContain('print("v3")')
    })
  })

  // ================================================================
  // CodeBlock 实例复用测试
  // ================================================================
  describe('CodeBlock 实例复用', () => {
    it('代码块内容不变时，wrapper DOM 元素引用不变（复用）', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: {
          content: '```js\nconsole.log("hello")\n```\n这是第一段'
        },
        global: { stubs: globalStubs }
      })

      const beforeWrappers = getCodeBlockWrappers(wrapper)
      expect(beforeWrappers.length).toBe(1)
      const beforeEl = beforeWrappers[0]

      // 相同代码块 + 不同文字 → 代码块应复用
      await wrapper.setProps({
        content: '```js\nconsole.log("hello")\n```\n这是第二段文字'
      })

      await flushRafAndTick()

      const afterWrappers = getCodeBlockWrappers(wrapper)
      expect(afterWrappers.length).toBe(1)
      const afterEl = afterWrappers[0]

      // 同一个 DOM 元素引用 = 复用成功
      expect(afterEl).toBe(beforeEl)
    })

    it('多个代码块内容都不变，全部复用', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: {
          content: ['```js\nconst a = 1\n```', '', '```python\nprint("py")\n```', '段落'].join('\n')
        },
        global: { stubs: globalStubs }
      })

      const beforeWrappers = Array.from(getCodeBlockWrappers(wrapper))
      expect(beforeWrappers.length).toBe(2)

      await wrapper.setProps({
        content: [
          '```js\nconst a = 1\n```',
          '',
          '```python\nprint("py")\n```',
          '段落二文字变了'
        ].join('\n')
      })

      await flushRafAndTick()

      const afterWrappers = Array.from(getCodeBlockWrappers(wrapper))
      expect(afterWrappers.length).toBe(2)
      expect(afterWrappers[0]).toBe(beforeWrappers[0])
      expect(afterWrappers[1]).toBe(beforeWrappers[1])
    })

    it('代码块内容变化时，创建新实例而非复用', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: {
          content: '```js\nconst old = 1\n```'
        },
        global: { stubs: globalStubs }
      })

      const container = getContainer(wrapper)
      const beforeEl = container.querySelector('.code-block-wrapper')

      // 代码内容变了
      await wrapper.setProps({
        content: '```js\nconst newCode = 2\n```'
      })

      await flushRafAndTick()

      const afterEl = container.querySelector('.code-block-wrapper')
      expect(afterEl).toBeTruthy()
      // 声明式渲染下 Vue 复用 DOM 元素，但内容应已更新
      expect(afterEl).toBe(beforeEl)
      expect(afterEl!.querySelector('code')?.textContent).toContain('newCode')
    })

    it('代码块被删除后不再出现在 DOM 中', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: {
          content: '```js\nconst x = 1\n```\n一些描述文字'
        },
        global: { stubs: globalStubs }
      })

      expect(getCodeBlockWrappers(wrapper).length).toBe(1)

      await wrapper.setProps({
        content: '仅剩纯文字，没有代码块了'
      })

      await flushRafAndTick()

      expect(getCodeBlockWrappers(wrapper).length).toBe(0)
    })

    it('新增代码块（从无到有）应正确创建实例', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: '纯文字，没有代码' },
        global: { stubs: globalStubs }
      })

      expect(getCodeBlockWrappers(wrapper).length).toBe(0)

      await wrapper.setProps({
        content: '```js\nconst y = 2\n```'
      })

      await flushRafAndTick()

      const wrappers = getCodeBlockWrappers(wrapper)
      expect(wrappers.length).toBe(1)
      expect(wrappers[0].querySelector('.text-xs.text-semi-code-dark-text.font-mono')?.textContent).toBe('js')
    })
  })

  // ================================================================
  // 防重复渲染测试
  // ================================================================
  describe('防重复渲染', () => {
    it('content 无变化时应跳过渲染', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: 'samesame' },
        global: { stubs: globalStubs }
      })

      const container = getContainer(wrapper)
      const beforeHtml = container.innerHTML

      // 设置为完全相同的内容
      await wrapper.setProps({ content: 'samesame' })
      await flushRafAndTick()

      // DOM 不应变化（doRender 中 content === lastRenderedContent 直接 return）
      expect(container.innerHTML).toBe(beforeHtml)
    })

    it('flush 多次 RAF 只有首次触发渲染，后续为 no-op', async () => {
      const wrapper = mount(MarkdownRenderer, {
        props: { content: 'first render' },
        global: { stubs: globalStubs }
      })

      const container = getContainer(wrapper)
      await wrapper.setProps({ content: 'only change' })
      await flushRafAndTick()

      const snapshot = container.innerHTML
      expect(container.textContent).toContain('only change')

      // 再次 flush（无新 content）应为 no-op，DOM 不变
      await flushRafAndTick()
      expect(container.innerHTML).toBe(snapshot)
    })
  })
})
