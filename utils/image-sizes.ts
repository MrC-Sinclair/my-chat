/**
 * @file 文生图尺寸常量（client/server 共享）
 *
 * 此文件必须保持纯净：禁止 import 任何 server-only 模块（如 ~/server/utils/imgbb），
 * 否则客户端打包时会将 fs 等 Node 内置模块拉入浏览器 bundle 导致构建失败。
 *
 * 服务端在 server/utils/image-generation.ts 中从此文件 re-export IMAGE_SIZES / ImageSize，
 * 客户端在 components/chat/ChatInput.vue 中直接从此文件 import。
 *
 * 与 server/utils/image-generation.ts 的 IMAGE_SIZES 必须保持同步（单一来源：本文件）。
 */

/** Kolors 支持的图片尺寸枚举（已通过 scripts/verify-siliconflow-image-api.mjs 实测被 API 接受） */
export const IMAGE_SIZES = [
  '1024x1024',
  '960x1280',
  '768x1024',
  '720x1440',
  '720x1280'
] as const

export type ImageSize = (typeof IMAGE_SIZES)[number]
