/** 模型能力描述 */
export interface ModelCapabilities {
  /** 是否支持图片理解（多模态） */
  vision: boolean
  /** 是否有思考能力（API 返回 reasoning_content），包含强制思考与可切换思考 */
  deepThinking: boolean
  /** 思考模式是否可通过 enable_thinking 参数开关控制（true=可切换，false=强制或不支持） */
  toggleableThinking: boolean
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
  // Qwen3-8B：默认启用思考（实测），支持 enable_thinking 开关切换，支持工具调用
  {
    label: 'Qwen3-8B',
    value: 'Qwen/Qwen3-8B',
    capabilities: { vision: false, deepThinking: true, toggleableThinking: true, toolCalling: true }
  },
  // DeepSeek-R1-0528-Qwen3-8B：强制思考模型，不认识 enable_thinking 参数（传了被忽略），不支持工具调用
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
  // Qwen3.5-4B：原生多模态（视觉+工具调用），默认启用思考模式但可通过 enable_thinking 关闭，256K 上下文
  {
    label: 'Qwen3.5-4B',
    value: 'Qwen/Qwen3.5-4B',
    capabilities: { vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true }
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
      deepThinking: false,
      toggleableThinking: false,
      toolCalling: true
    }
  )
}
