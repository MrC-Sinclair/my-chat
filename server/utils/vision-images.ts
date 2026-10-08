// server/utils/vision-images.ts —— 视觉模型多模态图片 parts 构造，供 chat.post.ts 使用
// 视觉消息的 image content part
export interface VisionImagePart {
  type: 'image'
  image: string | URL
  mimeType?: string
}

// 拆出 data URL 的 mimeType 与 base64 载荷，非 base64 输入返回 null
export function parseBase64Meta(dataUrl: string): { base64: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([\w/+-]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

// 硅基流动只接受 base64 图片，外部 URL（含 ImgBB 直链）一律 400 code 20040：
// 视觉分支用客户端原始 data URL，uploadedUrls 仅在客户端直接传 URL 时兜底。
export function buildVisionImageParts(
  uploadedUrls: string[],
  sourceImages: unknown[]
): VisionImagePart[] {
  return uploadedUrls.map((uploadedUrl, i) => {
    const source = sourceImages[i]
    const dataUrl = typeof source === 'string' && source.startsWith('data:') ? source : uploadedUrl
    if (dataUrl.startsWith('data:')) {
      const meta = parseBase64Meta(dataUrl)
      if (meta) return { type: 'image', image: meta.base64, mimeType: meta.mimeType }
      return { type: 'image', image: dataUrl }
    }
    return { type: 'image', image: new URL(dataUrl) }
  })
}
