/**
 * @file 图片生成服务 — 调用硅基流动 Kwai-Kolors/Kolors 生成图片，并通过 ImgBB 转存获取持久化 URL
 *
 * 设计要点（详见 openspec/changes/add-image-generation/design.md）：
 *   - base URL、API Key、模型名均从 useRuntimeConfig() 读取，不硬编码
 *   - 使用 AbortSignal.timeout(60_000) 控制 60 秒超时（标准静态方法，MDN Baseline 2024，Node 17.3+ 支持）
 *     注：不用 AbortController.prototype.timeout，该 API 在 Node v22 中为 undefined
 *   - 失败降级返回 { error, detail, query } 不抛异常（遵循项目工具错误返回模式）
 *   - 调用硅基流动 API 后立即通过 ImgBB 转存，避免 1 小时 URL 过期
 *   - ImgBB 转存失败时降级返回硅基流动原始 URL + warning 字段
 *   - H3 defineEventHandler 不支持 maxDuration（实测 h3@1.15.11 函数 length === 1），
 *     超时控制由本文件 fetch 层 + 部署平台 vercel.json maxDuration 共同保证
 */
import { uploadUrlToImgBb } from '~/server/utils/imgbb'
// IMAGE_SIZES / ImageSize 从共享文件 import + re-export，避免客户端 import 此文件时拉入 imgbb → fs
import { IMAGE_SIZES, type ImageSize } from '~/utils/image-sizes'
export { IMAGE_SIZES, type ImageSize }

/** Prompt 长度限制（Kolors 推荐 ≤ 500 token，按字符估算 2000 字符） */
const PROMPT_MAX_LENGTH = 2000

/** Seed 范围（硅基流动 API 约束：0 <= x <= 9999999999） */
const SEED_MIN = 0
const SEED_MAX = 9999999999

/** API 请求超时 60 秒（与 vercel.json maxDuration: 60 对齐） */
const API_TIMEOUT_MS = 60_000

/** 默认图片尺寸（通用性最佳） */
const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024'

/** 图片 alt 文本最大长度（超长截断加 "..."） */
const ALT_TEXT_MAX_LENGTH = 30

/** 生成图片参数 */
export interface GenerateImageParams {
  prompt: string
  seed?: number
  imageSize?: ImageSize
}

/** 生成图片结果 — 成功 */
export interface GenerateImageSuccess {
  imageUrl: string
  markdown: string
  seed: number
  inferenceTime: number
  warning?: string
  error?: never
}

/** 生成图片结果 — 失败 */
export interface GenerateImageFailure {
  error: string
  detail: string
  query: {
    prompt: string
    seed?: number
    imageSize?: string
  }
  imageUrl?: never
}

/** 生成图片结果类型 */
export type GenerateImageResult = GenerateImageSuccess | GenerateImageFailure

/**
 * 校验生成图片参数
 * @returns 校验通过返回 null，失败返回错误原因
 */
function validateParams(params: GenerateImageParams): string | null {
  const { prompt, seed, imageSize } = params

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return 'prompt 不能为空'
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return `prompt 长度超过 ${PROMPT_MAX_LENGTH} 字符（当前 ${prompt.length}）`
  }

  if (seed !== undefined) {
    if (
      typeof seed !== 'number' ||
      !Number.isFinite(seed) ||
      seed < SEED_MIN ||
      seed > SEED_MAX
    ) {
      return `seed 越界（应在 ${SEED_MIN}-${SEED_MAX} 之间）`
    }
  }

  if (imageSize !== undefined && !IMAGE_SIZES.includes(imageSize)) {
    return `imageSize 不在合法枚举中: ${imageSize}`
  }

  return null
}

/**
 * 构造图片 markdown alt 文本
 * 取 prompt 前 30 字符，超长截断加 "..."
 */
function buildImageAltText(prompt: string): string {
  if (prompt.length <= ALT_TEXT_MAX_LENGTH) {
    return prompt
  }
  return prompt.slice(0, ALT_TEXT_MAX_LENGTH) + '...'
}

/**
 * 调用硅基流动图片生成 API（POST /v1/images/generations）
 *
 * @returns 成功返回 { imageUrl, seed, inferenceTime }，失败抛异常（由上层捕获降级）
 */
async function callSiliconFlowImageApi(
  params: GenerateImageParams
): Promise<{ imageUrl: string; seed: number; inferenceTime: number }> {
  const config = useRuntimeConfig()
  const baseUrl = config.openAiBaseUrl || 'https://api.siliconflow.cn/v1'
  const apiKey = config.openAiApiKey
  const model = config.imageGenerationModel || 'Kwai-Kolors/Kolors'

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY')
  }

  const endpoint = `${baseUrl}/images/generations`
  const imageSize = params.imageSize || DEFAULT_IMAGE_SIZE

  // 请求体：model/prompt/image_size 必填，seed 可选
  const requestBody: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    image_size: imageSize
  }
  if (params.seed !== undefined) {
    requestBody.seed = params.seed
  }

  // 注：AbortSignal.timeout 是标准静态方法，触发后抛 TimeoutError/AbortError
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const data = await response.json()

  // 响应格式：{ images: [{ url }], timings: { inference }, seed }
  const imageUrl = data?.images?.[0]?.url
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error(`返回数据格式异常: ${JSON.stringify(data).slice(0, 200)}`)
  }

  // seed/inferenceTime 优先用 API 返回值，缺失时降级
  const seed = typeof data?.seed === 'number' ? data.seed : (params.seed ?? 0)
  const inferenceTime =
    typeof data?.timings?.inference === 'number' ? data.timings.inference : 0

  return { imageUrl, seed, inferenceTime }
}

/**
 * 调用 Kolors 生成图片并转存到 ImgBB 获取持久化 URL
 *
 * 流程：
 *   1. 参数校验
 *   2. 校验 OPENAI_API_KEY 配置
 *   3. 调用硅基流动 API 生成图片（返回 1 小时有效的临时 URL）
 *   4. 立即调用 uploadUrlToImgBb 转存为持久化 URL
 *   5. ImgBB 失败时降级返回原始 URL + warning 字段
 *
 * @param params 生成图片参数
 * @returns 成功返回 { imageUrl, markdown, seed, inferenceTime, warning? }，
 *          失败返回 { error, detail, query }
 */
export async function generateImageWithPersistence(
  params: GenerateImageParams
): Promise<GenerateImageResult> {
  // 1. 参数校验
  const validationError = validateParams(params)
  if (validationError) {
    return {
      error: '图片生成参数无效',
      detail: validationError,
      query: {
        prompt: params.prompt,
        seed: params.seed,
        imageSize: params.imageSize
      }
    }
  }

  // 2. 校验 API Key 配置（提前返回，避免发起无效请求）
  const config = useRuntimeConfig()
  if (!config.openAiApiKey) {
    return {
      error: '图片生成服务不可用',
      detail: '未配置 OPENAI_API_KEY',
      query: {
        prompt: params.prompt,
        seed: params.seed,
        imageSize: params.imageSize
      }
    }
  }

  try {
    // 3. 调用硅基流动 API
    const apiResult = await callSiliconFlowImageApi(params)
    const altText = buildImageAltText(params.prompt)

    // 4. 转存到 ImgBB
    try {
      const persistentUrl = await uploadUrlToImgBb(apiResult.imageUrl)
      return {
        imageUrl: persistentUrl,
        markdown: `![${altText}](${persistentUrl})`,
        seed: apiResult.seed,
        inferenceTime: apiResult.inferenceTime
      }
    } catch (imgbbError) {
      // ImgBB 转存失败，降级返回原始 URL + warning
      const detail = imgbbError instanceof Error ? imgbbError.message : String(imgbbError)
      console.warn(`[image-generation] ImgBB 转存失败，降级返回原始 URL: ${detail}`)
      return {
        imageUrl: apiResult.imageUrl,
        markdown: `![${altText}](${apiResult.imageUrl})`,
        seed: apiResult.seed,
        inferenceTime: apiResult.inferenceTime,
        warning: '图片链接 1 小时后失效，请及时保存'
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)

    // AbortSignal.timeout 抛 TimeoutError；AbortController.abort 抛 AbortError
    // 两者统一描述为「API 请求超时」
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError')
    ) {
      return {
        error: '图片生成服务不可用',
        detail: `API 请求超时（${API_TIMEOUT_MS / 1000}秒）`,
        query: {
          prompt: params.prompt,
          seed: params.seed,
          imageSize: params.imageSize
        }
      }
    }

    return {
      error: '图片生成服务不可用',
      detail,
      query: {
        prompt: params.prompt,
        seed: params.seed,
        imageSize: params.imageSize
      }
    }
  }
}
