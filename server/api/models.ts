/**
 * @file 可用模型列表 API — GET /api/models
 *
 * 返回当前 LLM Provider 支持的可用模型列表。
 * 前端通过此接口获取模型选项，实现动态模型切换。
 *
 * 返回格式：
 *   [{ label: "Qwen3-8B", value: "Qwen/Qwen3-8B" }, ...]
 */

import { AVAILABLE_MODELS } from '~/server/config/models'

export default defineEventHandler(() => {
  return AVAILABLE_MODELS
})
