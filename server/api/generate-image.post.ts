/**
 * @file 图片生成 API — POST /api/generate-image
 *
 * Workflow 路径入口：前端生图按钮点击后调用此 API
 *
 * 流程：
 *   1. 用 zod 校验 body（prompt 必填 1-2000 字符、seed 0-9999999999、imageSize 枚举）
 *   2. 校验失败 → 400 + createError
 *   3. 调用 generateImageWithPersistence() 生成图片 + ImgBB 转存
 *   4. 成功 → 200 + { imageUrl, markdown, seed, inferenceTime, warning? }
 *   5. 服务端错误 → 500 + createError（不暴露内部 detail）
 *
 * 超时控制说明：
 *   - H3 defineEventHandler 不支持 maxDuration 选项（实测 h3@1.15.11 函数 length === 1）
 *   - 60 秒超时由 image-generation.ts 内的 AbortSignal.timeout(60_000) 在 fetch 层完成
 *   - 部署到 Vercel 时由 vercel.json 的 functions.maxDuration: 60 兜底
 */
import { z } from 'zod'
import {
  generateImageWithPersistence,
  IMAGE_SIZES
} from '~/server/utils/image-generation'

/** 请求体 schema：与 Agent 工具 inputSchema 保持一致 */
const bodySchema = z.object({
  prompt: z
    .string()
    .min(1, 'prompt 不能为空')
    .max(2000, 'prompt 长度不能超过 2000 字符'),
  seed: z
    .number()
    .int('seed 必须为整数')
    .min(0, 'seed 不能小于 0')
    .max(9999999999, 'seed 不能大于 9999999999')
    .optional(),
  imageSize: z.enum(IMAGE_SIZES).optional(),
  // sessionId 字段：当前未使用（消息持久化由前端通过 /api/messages 完成），
  // 保留以兼容前端可能的传入，不强制校验
  sessionId: z.string().optional()
})

export default defineEventHandler(async (event) => {
  // 1. 读取并校验 body
  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    throw createError({
      statusCode: 400,
      statusMessage: firstError ? firstError.message : '请求参数无效'
    })
  }

  // 2. 构造调用参数（仅传已定义字段，避免传递 undefined）
  const params: {
    prompt: string
    seed?: number
    imageSize?: (typeof IMAGE_SIZES)[number]
  } = { prompt: parsed.data.prompt }
  if (parsed.data.seed !== undefined) {
    params.seed = parsed.data.seed
  }
  if (parsed.data.imageSize !== undefined) {
    params.imageSize = parsed.data.imageSize
  }

  // 3. 调用生成服务（内部已封装错误处理，不抛异常）
  const result = await generateImageWithPersistence(params)

  // 4. 失败：返回 500（不暴露内部 detail，避免泄露服务端信息）
  //    类型守卫：'detail' 字段仅在 GenerateImageFailure 中存在
  if ('detail' in result) {
    console.error('[generate-image API] 生成失败:', {
      error: result.error,
      detail: result.detail,
      query: result.query
    })
    throw createError({
      statusCode: 500,
      statusMessage: '图片生成服务不可用'
    })
  }

  // 5. 成功：返回 200 + 结构化结果
  return {
    imageUrl: result.imageUrl,
    markdown: result.markdown,
    seed: result.seed,
    inferenceTime: result.inferenceTime,
    // warning 字段仅在 ImgBB 转存失败时存在，前端据此提示用户保存
    ...(result.warning !== undefined && { warning: result.warning })
  }
})
