/**
 * @file 模型配置 — 集中管理可用模型列表
 *
 * 此文件是模型配置的唯一来源（Single Source of Truth）：
 *   - server/api/models.ts 读取此配置返回给前端
 *   - server/api/chat.post.ts 使用此配置作为白名单验证
 *
 * 添加新模型只需修改此文件，无需改动其他地方。
 */

/** 模型选项类型 */
export interface ModelOption {
  label: string
  value: string
}

/**
 * 可用模型配置
 *
 * label: 前端显示的友好名称
 * value: 调用 API 时使用的模型 ID（需与 LLM Provider 支持的模型名一致）
 */
export const AVAILABLE_MODELS: ModelOption[] = [
  { label: 'Qwen3-8B', value: 'Qwen/Qwen3-8B' },
  { label: 'DeepSeek-R1-0528-Qwen3-8B', value: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B' },
  { label: 'GLM-4.1V-9B-Thinking', value: 'THUDM/GLM-4.1V-9B-Thinking' }
]

/** 模型白名单（用于后端验证，防止用户使用未授权模型） */
export const ALLOWED_MODEL_VALUES = new Set(AVAILABLE_MODELS.map((m) => m.value))
