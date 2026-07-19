import { unlinkSync, existsSync } from 'fs'

const IMGBB_API_KEY = process.env.IMGBB_API_KEY || ''
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload'

export async function uploadToImgBb(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`)
  }

  if (!IMGBB_API_KEY) {
    throw new Error('缺少 IMGBB_API_KEY，请在 .env 中配置')
  }

  try {
    const fileBuffer = await import('fs').then((m) => m.promises.readFile(filePath))
    const base64 = fileBuffer.toString('base64')

    const formData = new FormData()
    formData.append('key', IMGBB_API_KEY)
    formData.append('image', base64)

    const res = await fetch(IMGBB_UPLOAD_URL, {
      method: 'POST',
      body: formData
    })

    const json = (await res.json()) as {
      success: boolean
      data?: { url: string; display_url?: string }
    }

    console.log('[imgbb] response:', JSON.stringify(json))

    if (!json.success || !json.data?.url) {
      throw new Error('imgbb 上传失败')
    }

    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch {
      // 文件可能已被系统清理
    }

    return json.data.url
  } catch (err) {
    console.error('[imgbb] upload error:', err)
    throw err
  }
}

/**
 * 从 URL 下载图片并上传到 ImgBB（用于硅基流动生图后的 URL 转存）
 *
 * @param imageUrl - 图片 URL（硅基流动返回的临时 URL，1 小时有效）
 * @returns ImgBB 持久化 URL
 */
export async function uploadUrlToImgBb(imageUrl: string): Promise<string> {
  if (!IMGBB_API_KEY) {
    throw new Error('缺少 IMGBB_API_KEY，请在 .env 中配置')
  }

  try {
    // 1. 下载图片
    const res = await fetch(imageUrl)
    if (!res.ok) {
      throw new Error(`下载图片失败: ${res.status} ${res.statusText}`)
    }

    const blob = await res.blob()

    // 2. 转为 base64
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')

    // 3. 上传到 ImgBB
    const formData = new FormData()
    formData.append('key', IMGBB_API_KEY)
    formData.append('image', base64)

    const uploadRes = await fetch(IMGBB_UPLOAD_URL, {
      method: 'POST',
      body: formData
    })

    const json = (await uploadRes.json()) as {
      success: boolean
      data?: { url: string; display_url?: string }
    }

    console.log('[imgbb] url upload response:', JSON.stringify(json))

    if (!json.success || !json.data?.url) {
      throw new Error('imgbb URL 上传失败')
    }

    return json.data.url
  } catch (err) {
    console.error('[imgbb] url upload error:', err)
    throw err
  }
}
