/**
 * @file 聊天配置 Composable
 *
 * 从 ai-chat.vue 中抽离的聊天配置逻辑，负责：
 *   - 深度思考模式开关
 *   - 模型选择（从 /api/models 动态获取）
 *   - 侧边栏显示控制
 *
 * 使用方式：
 *   const { enableThinking, currentModel, showSidebar, modelOptions } = useChatConfig()
 */

/** 可用模型选项 */
export interface ModelOption {
  label: string
  value: string
}

/** 本地 fallback 模型列表，API 不可用时使用 */
const FALLBACK_MODELS: ModelOption[] = [
  { label: 'Qwen3-8B', value: 'Qwen/Qwen3-8B' },
  { label: 'Qwen3-32B', value: 'Qwen/Qwen3-32B' },
  { label: 'DeepSeek-V3', value: 'deepseek-ai/DeepSeek-V3' },
  { label: 'GLM-4-9B', value: 'THUDM/glm-4-9b-chat' }
]

/**
 * 聊天配置 Composable
 *
 * @returns 聊天配置相关的响应式状态
 */
export function useChatConfig() {
  /** 是否开启深度思考模式 */
  const enableThinking = ref(true)

  /** 当前选中的模型 */
  const currentModel = ref('Qwen/Qwen3-8B')

  /** 控制侧边栏的显示/隐藏 */
  const showSidebar = ref(true)

  /** 可用模型列表（从 API 动态加载，失败则使用 fallback） */
  const modelOptions = ref<ModelOption[]>(FALLBACK_MODELS)

  /** 思考 token 预算 */
  const thinkingBudget = 4096

  /** 当前模型是否支持视觉（图片理解） */
  const supportsVision = computed(() => {
    const model = currentModel.value
    return model.includes('GLM-4.1V') || model.includes('Vision') || model.includes('VL')
  })

  /** 从 /api/models 加载模型列表 */
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

  /** 组件挂载时加载模型列表 */
  onMounted(() => {
    loadModels()
  })

  return {
    enableThinking,
    currentModel,
    showSidebar,
    modelOptions,
    thinkingBudget,
    supportsVision,
    loadModels
  }
}
