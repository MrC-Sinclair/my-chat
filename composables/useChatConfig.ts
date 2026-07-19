import type { ModelCapabilities, ModelConfig } from '~/server/config/models'

// 重新导出类型，供前端组件直接从 useChatConfig 引入，避免类型定义分散导致漂移
export type { ModelCapabilities, ModelConfig }

const FALLBACK_MODELS: ModelConfig[] = [
  {
    label: 'Qwen3-8B',
    value: 'Qwen/Qwen3-8B',
    capabilities: { vision: false, deepThinking: true, toggleableThinking: true, toolCalling: true }
  },
  {
    label: 'DeepSeek-R1-0528-Qwen3-8B',
    value: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
    capabilities: { vision: false, deepThinking: true, toggleableThinking: false, toolCalling: false }
  },
  // GLM-Z1-9B-0414：强制思考模型，传 enable_thinking 会 400 报错，无多模态，不支持工具调用
  {
    label: 'GLM-Z1-9B-0414',
    value: 'THUDM/GLM-Z1-9B-0414',
    capabilities: { vision: false, deepThinking: true, toggleableThinking: false, toolCalling: false }
  },
  // Qwen3.5-4B：与 server/config/models.ts 完全一致，确保 SSR 时 capabilities 判断准确
  // 缺失此项时 SSR 阶段会走默认 capabilities（碰巧正确），属脆弱的隐式行为
  {
    label: 'Qwen3.5-4B',
    value: 'Qwen/Qwen3.5-4B',
    capabilities: { vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true }
  }
]

export function useChatConfig() {
  const config = useRuntimeConfig()

  const enableThinking = ref(true)

  const enableWebSearch = ref(true)

  const enableOcr = ref(false)

  // 生图 Agent 工具开关：默认开启，与 enableWebSearch 一致
  // 由前端 toggle chip 控制，决定 LLM 是否能自主调用 generateImage 工具
  // 注：Workflow 路径（生图按钮触发 /api/generate-image）不受此开关影响
  const enableImageGeneration = ref(true)

  const currentModel = ref(config.public.defaultModel)

  const showSidebar = ref(false)

  const modelOptions = ref<ModelConfig[]>(FALLBACK_MODELS)

  const thinkingBudget = 4096

  const currentCapabilities = computed(() => {
    const found = modelOptions.value.find((opt) => opt.value === currentModel.value)
    return found?.capabilities ?? { vision: false, deepThinking: false, toggleableThinking: false, toolCalling: true }
  })

  const supportsVision = computed(() => currentCapabilities.value.vision)

  // OCR 工具是否可用：仅 toolCalling=true 的模型支持（Qwen3-8B / Qwen3.5-4B 显示，GLM-Z1/R1 隐藏）
  const currentSupportsOcr = computed(() => currentCapabilities.value.toolCalling)

  // 切换模型时重置开关：
  // - 思考开关：有思考能力的模型默认开启，无思考能力的模型关闭
  // - OCR 开关：切换到 toolCalling=false 的模型时自动关闭（避免 toggle 开启但工具不可用的不一致状态）
  // - 生图开关：切换到 toolCalling=false 的模型时自动关闭，切回 toolCalling=true 时恢复为默认开启
  //   （默认开启与 enableWebSearch 一致，让用户在新会话中能自然语言触发生图）
  watch(currentModel, () => {
    enableThinking.value = currentCapabilities.value.deepThinking
    if (!currentCapabilities.value.toolCalling) {
      enableOcr.value = false
      enableImageGeneration.value = false
    } else {
      enableImageGeneration.value = true
    }
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
    enableOcr,
    enableImageGeneration,
    currentModel,
    showSidebar,
    modelOptions,
    thinkingBudget,
    supportsVision,
    currentSupportsOcr,
    currentCapabilities,
    loadModels
  }
}
