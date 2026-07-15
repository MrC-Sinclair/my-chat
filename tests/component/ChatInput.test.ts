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
import type { ModelCapabilities, ModelConfig } from '~/composables/useChatConfig'

const defaultCapabilities: ModelCapabilities = {
  vision: false,
  deepThinking: false,
  toggleableThinking: false,
  toolCalling: true
}

const visionCapabilities: ModelCapabilities = {
  vision: true,
  deepThinking: false,
  toggleableThinking: false,
  toolCalling: false
}

const defaultModelOptions: ModelConfig[] = [
  {
    label: 'Qwen3-8B',
    value: 'Qwen/Qwen3-8B',
    capabilities: { vision: false, deepThinking: false, toggleableThinking: false, toolCalling: true }
  },
  {
    label: 'DeepSeek-R1',
    value: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
    capabilities: { vision: false, deepThinking: true, toggleableThinking: false, toolCalling: false }
  }
]

function mountChatInput(
  overrides: { props?: Partial<InstanceType<typeof ChatInput>['$props']> } = {}
) {
  const props = {
    input: '',
    isLoading: false,
    enableThinking: false,
    enableWebSearch: false,
    enableOcr: false,
    images: [],
    supportsVision: false,
    supportsOcr: false,
    currentCapabilities: defaultCapabilities,
    modelOptions: defaultModelOptions,
    currentModel: 'Qwen/Qwen3-8B',
    ...overrides.props
  }
  return mount(ChatInput, {
    props
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
      const counter = wrapper.find('.text-semi-micro-md')
      expect(counter.text()).toContain('2')
      expect(counter.text()).toContain('1000')
    })

    it('字数超过 80% 但未超限时显示警告色', () => {
      const wrapper = mountChatInput({
        props: { input: 'a'.repeat(850) }
      })
      const counter = wrapper.find('.text-semi-micro-md')
      expect(counter.classes()).toContain('text-semi-warning')
    })

    it('字数超限时显示红色', () => {
      const wrapper = mountChatInput({
        props: { input: 'a'.repeat(1001) }
      })
      const counter = wrapper.find('.text-semi-micro-md')
      expect(counter.classes()).toContain('text-semi-danger')
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

  describe('OCR 开关', () => {
    it('toolCalling=true 时 OCR 按钮应渲染', () => {
      const wrapper = mountChatInput({
        props: { supportsOcr: true, currentCapabilities: defaultCapabilities }
      })
      const buttons = wrapper.findAll('button')
      const ocrBtn = buttons.find((btn) => btn.text().includes('OCR'))
      expect(ocrBtn).toBeTruthy()
    })

    it('supportsOcr=false 时 OCR 按钮不渲染', () => {
      const wrapper = mountChatInput({
        props: { supportsOcr: false, currentCapabilities: visionCapabilities }
      })
      const buttons = wrapper.findAll('button')
      const ocrBtn = buttons.find((btn) => btn.text().includes('OCR'))
      expect(ocrBtn).toBeUndefined()
    })

    it('点击 OCR 按钮应触发 update:enableOcr 事件', async () => {
      const wrapper = mountChatInput({
        props: { supportsOcr: true, enableOcr: false }
      })
      const buttons = wrapper.findAll('button')
      const ocrBtn = buttons.find((btn) => btn.text().includes('OCR'))
      expect(ocrBtn).toBeTruthy()
      await ocrBtn!.trigger('click')
      const emitted = wrapper.emitted('update:enableOcr')
      expect(emitted).toBeTruthy()
      // 当前 enableOcr=false，点击后应 emit true
      expect(emitted![0][0]).toBe(true)
    })

    it('OCR 开启时按钮应有高亮样式（bg-semi-primary-light）', () => {
      const wrapper = mountChatInput({
        props: { supportsOcr: true, enableOcr: true }
      })
      const buttons = wrapper.findAll('button')
      const ocrBtn = buttons.find((btn) => btn.text().includes('OCR'))
      expect(ocrBtn).toBeTruthy()
      expect(ocrBtn!.classes()).toContain('bg-semi-primary-light')
      expect(ocrBtn!.classes()).toContain('text-semi-primary-active')
    })

    it('OCR 关闭时按钮应为默认样式（bg-semi-fill-0）', () => {
      const wrapper = mountChatInput({
        props: { supportsOcr: true, enableOcr: false }
      })
      const buttons = wrapper.findAll('button')
      const ocrBtn = buttons.find((btn) => btn.text().includes('OCR'))
      expect(ocrBtn).toBeTruthy()
      expect(ocrBtn!.classes()).toContain('bg-semi-fill-0')
      expect(ocrBtn!.classes()).toContain('text-semi-text-2')
    })
  })

  describe('图片上传与 OCR 联动', () => {
    it('视觉模型图片上传按钮始终可用（不论 OCR 开关）', () => {
      const wrapper = mountChatInput({
        props: {
          supportsVision: true,
          supportsOcr: false,
          enableOcr: false,
          currentCapabilities: visionCapabilities
        }
      })
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.attributes('disabled')).toBeUndefined()
    })

    it('非视觉模型 + OCR 开启时图片上传按钮可用', () => {
      const wrapper = mountChatInput({
        props: {
          supportsVision: false,
          supportsOcr: true,
          enableOcr: true,
          currentCapabilities: defaultCapabilities
        }
      })
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.attributes('disabled')).toBeUndefined()
    })

    it('非视觉模型 + OCR 关闭时图片上传按钮禁用', () => {
      const wrapper = mountChatInput({
        props: {
          supportsVision: false,
          supportsOcr: true,
          enableOcr: false,
          currentCapabilities: defaultCapabilities
        }
      })
      const fileInput = wrapper.find('input[type="file"]')
      expect(fileInput.attributes('disabled')).toBeDefined()
    })
  })

  describe('模型选择', () => {
    it('应渲染所有模型 chip', () => {
      const wrapper = mountChatInput()
      const chips = wrapper.findAll('[data-testid="model-chip"]')
      expect(chips).toHaveLength(2)
      expect(chips[0].text()).toBe('Qwen3-8B')
      expect(chips[1].text()).toBe('DeepSeek-R1')
    })

    it('当前选中模型 chip 应有高亮样式', () => {
      const wrapper = mountChatInput()
      const chips = wrapper.findAll('[data-testid="model-chip"]')
      // 默认 currentModel 是第一个模型，应高亮
      expect(chips[0].classes()).toContain('bg-semi-primary/10')
      expect(chips[1].classes()).not.toContain('bg-semi-primary/10')
    })

    it('点击模型 chip 应触发 selectModel 事件', async () => {
      const wrapper = mountChatInput()
      const chips = wrapper.findAll('[data-testid="model-chip"]')
      await chips[1].trigger('click')
      const emitted = wrapper.emitted('selectModel')
      expect(emitted).toBeTruthy()
      expect(emitted![0][0]).toBe('deepseek-ai/DeepSeek-R1-0528-Qwen3-8B')
    })

    it('modelOptions 为空时不渲染 chip 组', () => {
      const wrapper = mountChatInput({ props: { modelOptions: [] } })
      expect(wrapper.find('[data-testid="model-chip"]').exists()).toBe(false)
    })
  })
})
