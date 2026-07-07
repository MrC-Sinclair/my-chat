/**
 * useChatConfig composable 单元测试
 *
 * 测试内容：
 * - enableOcr 初始值为 false
 * - currentSupportsOcr 跟随 currentCapabilities.toolCalling
 * - 切换到 toolCalling=false 模型时 enableOcr 自动重置为 false
 * - 切换到 toolCalling=true 模型时 enableOcr 保持当前值
 *
 * 说明：useChatConfig 使用了 Nuxt 的 useRuntimeConfig 和 $fetch 自动导入，
 * 此处通过 vi.stubGlobal 模拟。Vue 的 ref/computed/watch/onMounted 由
 * unplugin-auto-import 自动注入。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

// 模拟 useRuntimeConfig：返回包含 defaultModel 的 public 配置
const mockUseRuntimeConfig = vi.fn(() => ({
  public: {
    defaultModel: 'Qwen/Qwen3-8B'
  }
}))

// 模拟 $fetch：默认返回空数组让 loadModels 走 fallback
const mockFetch = vi.fn().mockResolvedValue([])

vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)
vi.stubGlobal('$fetch', mockFetch)

// 动态导入以应用 stubs
const { useChatConfig } = await import('~/composables/useChatConfig')

describe('useChatConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue([])
  })

  it('enableOcr 初始值应为 false', () => {
    const config = useChatConfig()
    expect(config.enableOcr.value).toBe(false)
  })

  it('enableWebSearch 初始值应为 true', () => {
    const config = useChatConfig()
    expect(config.enableWebSearch.value).toBe(true)
  })

  it('currentSupportsOcr 在 toolCalling=true 模型上应为 true', () => {
    const config = useChatConfig()
    // 默认 currentModel = 'Qwen/Qwen3-8B'，FALLBACK_MODELS 中 capabilities.toolCalling=true
    expect(config.currentSupportsOcr.value).toBe(true)
  })

  it('切换到 toolCalling=false 模型时 enableOcr 应自动重置为 false', async () => {
    const config = useChatConfig()
    // 先开启 OCR
    config.enableOcr.value = true
    expect(config.enableOcr.value).toBe(true)

    // 切换到 DeepSeek-R1（toolCalling=false）
    config.currentModel.value = 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B'
    await nextTick()

    expect(config.enableOcr.value).toBe(false)
    expect(config.currentSupportsOcr.value).toBe(false)
  })

  it('切换到 toolCalling=true 模型时 enableOcr 应保持当前值', async () => {
    const config = useChatConfig()
    // 默认 Qwen3-8B（toolCalling=true），开启 OCR
    config.enableOcr.value = true

    // 切换到 Qwen3.5-4B（toolCalling=true）
    config.currentModel.value = 'Qwen/Qwen3.5-4B'
    await nextTick()

    expect(config.enableOcr.value).toBe(true)
    expect(config.currentSupportsOcr.value).toBe(true)
  })

  it('切换到 GLM-Z1（toolCalling=false）后再切回 Qwen3-8B，OCR 应保持关闭', async () => {
    const config = useChatConfig()
    config.enableOcr.value = true

    // 切换到 GLM-Z1（toolCalling=false），OCR 自动关闭
    config.currentModel.value = 'THUDM/GLM-Z1-9B-0414'
    await nextTick()
    expect(config.enableOcr.value).toBe(false)

    // 切回 Qwen3-8B（toolCalling=true），OCR 应保持关闭（不会自动开启）
    config.currentModel.value = 'Qwen/Qwen3-8B'
    await nextTick()
    expect(config.enableOcr.value).toBe(false)
  })

  it('supportsVision 在 Qwen3.5-4B 上应为 true', async () => {
    const config = useChatConfig()
    config.currentModel.value = 'Qwen/Qwen3.5-4B'
    await nextTick()
    expect(config.supportsVision.value).toBe(true)
  })

  it('FALLBACK_MODELS 应包含 Qwen3.5-4B（与 server/config/models.ts 一致）', () => {
    const config = useChatConfig()
    const qwen35 = config.modelOptions.value.find((m) => m.value === 'Qwen/Qwen3.5-4B')
    expect(qwen35).toBeTruthy()
    expect(qwen35!.capabilities).toEqual({
      vision: true,
      deepThinking: true,
      toggleableThinking: true,
      toolCalling: true
    })
  })
})
