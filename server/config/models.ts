/** 模型能力描述 */
export interface ModelCapabilities {
  /** 是否支持图片理解（多模态） */
  vision: boolean
  /** 是否支持深度思考/推理 */
  reasoning: boolean
  /** 是否支持工具调用（function calling） */
  toolCalling: boolean
}

/** 模型配置项 */
export interface ModelConfig {
  /** 前端显示名称 */
  label: string
  /** 模型唯一标识，对应 LLM API 的 model 参数 */
  value: string
  /** 模型能力集合 */
  capabilities: ModelCapabilities
}

/** 可用模型白名单，新增模型需在此处同步添加 */
export const AVAILABLE_MODELS: ModelConfig[] = [
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

/** 允许使用的模型值集合，chat.post.ts 中用于校验请求的 model 参数 */
export const ALLOWED_MODEL_VALUES = new Set(AVAILABLE_MODELS.map((m) => m.value))

/** 模型值 → 配置映射，用于快速查找 */
const MODEL_CONFIG_MAP = new Map(AVAILABLE_MODELS.map((m) => [m.value, m]))

/**
 * 根据 model 值获取对应能力配置
 * 未匹配时返回默认能力：无视觉、无推理、支持工具调用
 */
export function getModelCapabilities(modelValue: string): ModelCapabilities {
  return (
    MODEL_CONFIG_MAP.get(modelValue)?.capabilities ?? {
      vision: false,
      reasoning: false,
      toolCalling: true
    }
  )
}
