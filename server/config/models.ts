export interface ModelCapabilities {
  vision: boolean
  reasoning: boolean
  toolCalling: boolean
}

export interface ModelConfig {
  label: string
  value: string
  capabilities: ModelCapabilities
}

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

export const ALLOWED_MODEL_VALUES = new Set(AVAILABLE_MODELS.map((m) => m.value))

const MODEL_CONFIG_MAP = new Map(AVAILABLE_MODELS.map((m) => [m.value, m]))

export function getModelCapabilities(modelValue: string): ModelCapabilities {
  return MODEL_CONFIG_MAP.get(modelValue)?.capabilities ?? { vision: false, reasoning: false, toolCalling: true }
}
