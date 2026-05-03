export interface ModelCapabilities {
  vision: boolean
  reasoning: boolean
  toolCalling: boolean
}

export interface ModelOption {
  label: string
  value: string
  capabilities: ModelCapabilities
}

const FALLBACK_MODELS: ModelOption[] = [
  {
    label: 'Qwen3-8B',
    value: 'Qwen/Qwen3-8B',
    capabilities: { vision: false, reasoning: false, toolCalling: true }
  },
  {
    label: 'DeepSeek-R1-0528-Qwen3-8B',
    value: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
    capabilities: { vision: false, reasoning: true, toolCalling: false }
  },
  {
    label: 'GLM-4.1V-9B-Thinking',
    value: 'THUDM/GLM-4.1V-9B-Thinking',
    capabilities: { vision: true, reasoning: true, toolCalling: false }
  }
]

export function useChatConfig() {
  const config = useRuntimeConfig()

  const enableThinking = ref(true)

  const enableWebSearch = ref(true)

  const currentModel = ref(config.public.defaultModel)

  const showSidebar = ref(false)

  const modelOptions = ref<ModelOption[]>(FALLBACK_MODELS)

  const thinkingBudget = 4096

  const currentCapabilities = computed(() => {
    const found = modelOptions.value.find((opt) => opt.value === currentModel.value)
    return found?.capabilities ?? { vision: false, reasoning: false, toolCalling: true }
  })

  const supportsVision = computed(() => currentCapabilities.value.vision)

  async function loadModels() {
    try {
      const data = await $fetch<ModelOption[]>('/api/models')
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
