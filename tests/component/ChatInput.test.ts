/**
 * ChatInput 组件测试
 *
 * 测试核心交互逻辑：
 * - Enter 发送 / Shift+Enter 换行
 * - 输入字数限制（MAX_INPUT_LENGTH=1000）
 * - 字数接近上限时的警告色
 * - 发送按钮在空输入/超限时禁用
 * - 图片上传数量上限（MAX_IMAGES=5）
 * - 图片删除事件
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatInput from '~/components/chat/ChatInput.vue'
import type { ModelCapabilities } from '~/composables/useChatConfig'

const defaultCapabilities: ModelCapabilities = {
  vision: false,
  deepThinking: false,
  toolCalling: true
}

const visionCapabilities: ModelCapabilities = {
  vision: true,
  deepThinking: false,
  toolCalling: false
}

function mountChatInput(overrides: { props?: Partial<InstanceType<typeof ChatInput>['$props']> } = {}) {
  const props = {
    input: '',
    isLoading: false,
    enableThinking: false,
    enableWebSearch: false,
    images: [],
    supportsVision: false,
    currentCapabilities: defaultCapabilities,
    ...overrides.props
  }
  return mount(ChatInput, {
    props,
    global: {
      stubs: {
        // v-tooltip 指令在测试环境未注册，用 stub 避免警告
        tooltip: true
      }
    }
  })
}

describe('ChatInput 组件', () => {
  describe('输入与字数限制', () => {
    it('空输入时发送按钮应禁用', () => {
      const wrapper = mountChatInput({ props: { input: '' } })
      const sendBtn = wrapper.find('[data-testid="send-btn"]')
      expect(sendBtn.attributes('disabled')).toBeDefined()
    })

    it('有输入时发送按钮应启用', () => {
      const wrapper = mountChatInput({ props: { input: '你好' } })
      const sendBtn = wrapper.find('[data-testid="send-btn"]')
      expect(sendBtn.attributes('disabled')).toBeUndefined()
    })

    it('输入超过 1000 字时发送按钮应禁用', () => {
      const wrapper = mountChatInput({
        props: { input: 'a'.repeat(1001) }
      })
      const sendBtn = wrapper.find('[data-testid="send-btn"]')
      expect(sendBtn.attributes('disabled')).toBeDefined()
    })

    it('字数计数器在输入时显示', () => {
      const wrapper = mountChatInput({ props: { input: '测试' } })
      const counter = wrapper.find('.text-\\[11px\\]')
      expect(counter.text()).toContain('2')
      expect(counter.text()).toContain('1000')
    })

    it('字数超过 80% 但未超限时显示警告色', () => {
      const wrapper = mountChatInput({
        props: { input: 'a'.repeat(850) }
      })
      const counter = wrapper.find('.text-\\[11px\\]')
      expect(counter.classes()).toContain('text-amber-500')
    })

    it('字数超限时显示红色', () => {
      const wrapper = mountChatInput({
        props: { input: 'a'.repeat(1001) }
      })
      const counter = wrapper.find('.text-\\[11px\\]')
      expect(counter.classes()).toContain('text-red-500')
    })
  })

  describe('键盘交互', () => {
    it('Enter 键应触发 submit 事件', async () => {
      const wrapper = mountChatInput({ props: { input: '你好' } })
      const textarea = wrapper.find('[data-testid="chat-input"]')
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
      expect(wrapper.emitted('submit')).toBeTruthy()
    })

    it('Shift+Enter 不应触发 submit 事件', async () => {
      const wrapper = mountChatInput({ props: { input: '你好' } })
      const textarea = wrapper.find('[data-testid="chat-input"]')
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
      expect(wrapper.emitted('submit')).toBeFalsy()
    })

    it('输入超限时 Enter 不应触发 submit', async () => {
      const wrapper = mountChatInput({
        props: { input: 'a'.repeat(1001) }
      })
      const textarea = wrapper.find('[data-testid="chat-input"]')
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
      expect(wrapper.emitted('submit')).toBeFalsy()
    })

    it('输入法组合期间 Enter 不应触发 submit', async () => {
      const wrapper = mountChatInput({ props: { input: '你好' } })
      const textarea = wrapper.find('[data-testid="chat-input"]')
      // 模拟输入法组合开始
      await textarea.trigger('compositionstart')
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
      expect(wrapper.emitted('submit')).toBeFalsy()
    })
  })

  describe('加载状态', () => {
    it('加载中应显示停止按钮而非发送按钮', () => {
      const wrapper = mountChatInput({ props: { isLoading: true, input: '你好' } })
      expect(wrapper.find('[data-testid="stop-btn"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="send-btn"]').exists()).toBe(false)
    })

    it('点击停止按钮应触发 stop 事件', async () => {
      const wrapper = mountChatInput({ props: { isLoading: true, input: '你好' } })
      await wrapper.find('[data-testid="stop-btn"]').trigger('click')
      expect(wrapper.emitted('stop')).toBeTruthy()
    })
  })

  describe('图片上传（视觉模型）', () => {
    it('非视觉模型不应显示图片上传入口为可点击', () => {
      const wrapper = mountChatInput({
        props: { supportsVision: false, currentCapabilities: defaultCapabilities }
      })
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.attributes('disabled')).toBeDefined()
    })

    it('视觉模型且图片数达上限时文件输入应禁用', () => {
      const wrapper = mountChatInput({
        props: {
          supportsVision: true,
          currentCapabilities: visionCapabilities,
          images: Array.from({ length: 5 }, (_, i) => ({
            id: `img-${i}`,
            dataUrl: `data:image/png;base64,${i}`,
            filename: `test-${i}.png`
          }))
        }
      })
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.attributes('disabled')).toBeDefined()
    })

    it('点击删除按钮应触发 update:images 事件并移除对应图片', async () => {
      const images = [
        { id: 'img-1', dataUrl: 'data:image/png;base64,1', filename: 'a.png' },
        { id: 'img-2', dataUrl: 'data:image/png;base64,2', filename: 'b.png' }
      ]
      const wrapper = mountChatInput({
        props: {
          supportsVision: true,
          currentCapabilities: visionCapabilities,
          images
        }
      })
      const removeButtons = wrapper.findAll('button')
      // 找到图片删除按钮（带 X 图标的圆形按钮）
      const removeBtn = removeButtons.find((btn) => btn.find('svg line').exists())
      expect(removeBtn).toBeTruthy()
      await removeBtn!.trigger('click')
      const emitted = wrapper.emitted('update:images')
      expect(emitted).toBeTruthy()
      expect(emitted![0][0]).toHaveLength(1)
    })
  })

  describe('功能开关', () => {
    it('点击思考按钮应触发 update:enableThinking 事件', async () => {
      const wrapper = mountChatInput()
      // 思考按钮文本包含"思考"
      const buttons = wrapper.findAll('button')
      const thinkingBtn = buttons.find((btn) => btn.text().includes('思考'))
      expect(thinkingBtn).toBeTruthy()
      await thinkingBtn!.trigger('click')
      const emitted = wrapper.emitted('update:enableThinking')
      expect(emitted).toBeTruthy()
      expect(emitted![0][0]).toBe(true)
    })

    it('视觉模型不显示联网搜索按钮', () => {
      const wrapper = mountChatInput({
        props: { currentCapabilities: visionCapabilities }
      })
      // 联网按钮有 v-if="!currentCapabilities.vision"
      const buttons = wrapper.findAll('button')
      const webSearchBtn = buttons.find((btn) => btn.text().includes('联网'))
      expect(webSearchBtn).toBeUndefined()
    })
  })
})
