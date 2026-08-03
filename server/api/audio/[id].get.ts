/**
 * @file 音频文件代理访问 API — GET /api/audio/:id
 *
 * 语音消息音频文件存放在 server/uploads/audio/（不对外暴露），
 * 通过此路由代理访问，文件名格式 `<timestamp>-<uuid>.webm`。
 *
 * 安全设计（决策 2）：
 *   - 文件名 UUID 不可猜测，防御枚举攻击
 *   - 严格校验文件名格式（`<数字>-<uuid>.webm`），防路径遍历攻击
 *   - 文件不存在返回 404（不暴露内部目录结构）
 *
 * 部署限制：与 transcribe.post.ts 一致，Vercel 等 Serverless 平台不可用。
 */
import { existsSync, createReadStream, statSync } from 'node:fs'
import { join } from 'node:path'

/** 音频文件存放目录（与 transcribe.post.ts 保持一致） */
const AUDIO_UPLOAD_DIR = join(process.cwd(), 'server', 'uploads', 'audio')

/**
 * 文件名格式校验：`<timestamp>-<uuid>.webm`
 *
 * - timestamp: 13 位数字（Date.now()）
 * - uuid: 标准 UUID v4 格式（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）
 * - 扩展名：.webm
 *
 * 严格校验防御路径遍历攻击（如 ../../etc/passwd）和枚举攻击。
 */
const FILENAME_REGEX = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webm$/i

export default defineEventHandler((event) => {
  if (process.env.VERCEL) {
    throw createError({
      statusCode: 501,
      statusMessage: '语音消息功能在 Serverless 平台不可用'
    })
  }

  const id = getRouterParam(event, 'id')
  if (!id || !FILENAME_REGEX.test(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: '无效的音频文件标识'
    })
  }

  // 二次防御：解析后的路径必须仍在 AUDIO_UPLOAD_DIR 内（防符号链接绕过）
  const filePath = join(AUDIO_UPLOAD_DIR, id)
  if (!filePath.startsWith(AUDIO_UPLOAD_DIR)) {
    throw createError({
      statusCode: 400,
      statusMessage: '无效的音频文件标识'
    })
  }

  if (!existsSync(filePath)) {
    // 文件已被 TTL 清理或不存在：返回 404，前端降级为纯文字气泡（决策 2）
    throw createError({
      statusCode: 404,
      statusMessage: '音频文件不存在或已过期'
    })
  }

  const stat = statSync(filePath)

  // 设置响应头：audio/webm + 缓存控制 + 文件大小
  setResponseHeader(event, 'Content-Type', 'audio/webm')
  setResponseHeader(event, 'Content-Length', stat.size)
  // 静态资源缓存 7 天（与 TTL 一致），过期后 404 由前端降级处理
  setResponseHeader(event, 'Cache-Control', 'private, max-age=604800')
  setResponseHeader(event, 'Accept-Ranges', 'bytes')

  // 流式返回文件（不读入内存，支持大文件）
  return sendStream(event, createReadStream(filePath))
})
