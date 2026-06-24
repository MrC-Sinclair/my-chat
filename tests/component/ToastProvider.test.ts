/**
 * ToastProvider 组件测试
 *
 * 测试 Toast 通知系统的核心逻辑：
 * - provide 注入的 toast API（show/success/error/info）
 * - Toast 项的添加与自动移除（setTimeout）
 * - 不同类型 Toast 的样式差异
 * - 多个 Toast 并存
 *
 * 策略：通过子组件调用 useToast() 并 defineExpose 暴露给测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ToastProvider from '~/components/ToastProvider.vue'

// 创建一个消费者组件，通过 useToast() 获取 toast API 并暴露给测试
const ToastConsumer = defineComponent({
  setup() {
    // 直接 inject 'toast'，与 useToast() 等价
    const toast = inject<any>('toast')
    // 暴露给测试通过 vm 访问
    return { toast }
  },
  render() {
    return h('div', { id: 'consumer' }, this.toast ? 'has-toast' : 'no-toast')
  }
})

function mountToastProvider() {
  return mount(ToastProvider, {
    slots: {
      default: ToastConsumer
    },
    global: {
      stubs: {
        Teleport: true
      }
    }
  })
}

// 直接访问 ToastProvider 内部 toasts 状态（setupState）
function getToasts(wrapper: ReturnType<typeof mountToastProvider>) {
  return (wrapper.vm as any).$.setupState.toasts as any[]
}

describe('ToastProvider 组件', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应通过 provide 注入 toast API', () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    expect(consumer.vm.toast).toBeTruthy()
    expect(consumer.vm.toast.success).toBeTypeOf('function')
    expect(consumer.vm.toast.error).toBeTypeOf('function')
    expect(consumer.vm.toast.info).toBeTypeOf('function')
    expect(consumer.vm.toast.show).toBeTypeOf('function')
  })

  it('success 调用后应显示绿色 Toast', async () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    consumer.vm.toast.success('操作成功')
    await nextTick()
    const toastEl = wrapper.find('.bg-green-50')
    expect(toastEl.exists()).toBe(true)
    expect(toastEl.text()).toContain('操作成功')
  })

  it('error 调用后应显示红色 Toast', async () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    consumer.vm.toast.error('操作失败')
    await nextTick()
    const toastEl = wrapper.find('.bg-red-50')
    expect(toastEl.exists()).toBe(true)
    expect(toastEl.text()).toContain('操作失败')
  })

  it('info 调用后应显示蓝色 Toast', async () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    consumer.vm.toast.info('提示信息')
    await nextTick()
    const toastEl = wrapper.find('.bg-blue-50')
    expect(toastEl.exists()).toBe(true)
    expect(toastEl.text()).toContain('提示信息')
  })

  it('Toast 应在指定时间后自动移除', async () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    consumer.vm.toast.show('临时消息', 'info', 3000)
    await nextTick()
    expect(getToasts(wrapper)).toHaveLength(1)

    // 快进 2999ms，Toast 仍应存在
    vi.advanceTimersByTime(2999)
    await flushPromises()
    expect(getToasts(wrapper)).toHaveLength(1)

    // 快进到 3000ms，Toast 应被移除
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(getToasts(wrapper)).toHaveLength(0)
  })

  it('error Toast 默认持续 5000ms', async () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    consumer.vm.toast.error('错误消息')
    await nextTick()
    expect(getToasts(wrapper)).toHaveLength(1)

    vi.advanceTimersByTime(4999)
    await flushPromises()
    expect(getToasts(wrapper)).toHaveLength(1)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(getToasts(wrapper)).toHaveLength(0)
  })

  it('多个 Toast 可并存', async () => {
    const wrapper = mountToastProvider()
    const consumer = wrapper.findComponent(ToastConsumer)
    consumer.vm.toast.success('消息1')
    consumer.vm.toast.success('消息2')
    consumer.vm.toast.error('消息3')
    await nextTick()
    const allToasts = wrapper.findAll('[class*="bg-green-50"], [class*="bg-red-50"]')
    expect(allToasts).toHaveLength(3)
  })
})
