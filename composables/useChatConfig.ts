import type { ModelCapabilities, ModelConfig } from '~/server/config/models'

// 重新导出类型，供前端组件直接从 useChatConfig 引入，避免类型定义分散导致漂移
export type { ModelCapabilities, ModelConfig }

const FALLBACK_MODELS: ModelConfig[] = [
  {
    label: 'Qwen3-8B',
    value: 'Qwen/Qwen3-8B',
    capabilities: { vision: false, deepThinking: false, toolCalling: true }
  },
  {
    label: 'DeepSeek-R1-0528-Qwen3-8B',
    value: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
    capabilities: { vision: false, deepThinking: true, toolCalling: false }
  },
  // GLM-Z1-9B-0414：强制思考模式（关闭开关也会思考），无多模态，不支持工具调用
  {
    label: 'GLM-Z1-9B-0414',
    value: 'THUDM/GLM-Z1-9B-0414',
    capabilities: { vision: false, deepThinking: true, toolCalling: false }
  }
]

export function useChatConfig() {
  const config = useRuntimeConfig()

  const enableThinking = ref(true)

  const enableWebSearch = ref(true)

  const currentModel = ref(config.public.defaultModel)

  const showSidebar = ref(false)

  const modelOptions = ref<ModelConfig[]>(FALLBACK_MODELS)

  const thinkingBudget = 4096

  const currentCapabilities = computed(() => {
    const found = modelOptions.value.find((opt) => opt.value === currentModel.value)
    return found?.capabilities ?? { vision: false, deepThinking: false, toolCalling: true }
  })

  const supportsVision = computed(() => currentCapabilities.value.vision)

  watch(currentModel, () => {
    enableThinking.value = !currentCapabilities.value.deepThinking
  })

  async function loadModels() {
    try {
      const data = await $fetch<ModelConfig[]>('/api/models')
      if (data && data.length > 0) {
        modelOptions.value = data
      }
    } catch (err) {
      console.error('加载模型列表失败，使用本地 fallback:', err)
    }
  }

  onMounted(() => {
    loadModels()
  })

  return {
    enableThinking,
    enableWebSearch,
    currentModel,
    showSidebar,
    modelOptions,
    thinkingBudget,
    supportsVision,
    currentCapabilities,
    loadModels
  }
}
