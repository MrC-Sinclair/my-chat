// tests/unit/vision-images.test.ts —— 视觉图片 parts 构造（硅基流动只接受 base64）
import { describe, it, expect } from 'vitest'
import { buildVisionImageParts, parseBase64Meta } from '~/server/utils/vision-images'

// 测试用最小 PNG data URL
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

// ImgBB 公网直链，模型侧只作为无 base64 时的兜底
const IMG_URL = 'https://i.ibb.co/x/a.png'

// 拆分 data URL 头部与 base64 载荷
describe('parseBase64Meta', () => {
  // 合法 data URL 解析出 mimeType 与载荷
  it('解析 data URL 的 mimeType 与 base64 载荷', () => {
    expect(parseBase64Meta(DATA_URL)).toEqual({ mimeType: 'image/png', base64: 'iVBORw0KGgo=' })
  })

  // 不匹配正则（http URL / 缺 base64 段）时返回 null
  it('非 base64 data URL 返回 null', () => {
    expect(parseBase64Meta('https://i.ibb.co/x/a.png')).toBeNull()
    expect(parseBase64Meta('data:image/png,not-base64')).toBeNull()
  })
})

// 视觉模型 content parts 的图片来源选择
describe('buildVisionImageParts', () => {
  // 客户端传 data URL 时必须用 base64，即使 ImgBB 已返回公网 URL
  it('客户端传 data URL 时用 base64，即使 ImgBB 已返回公网 URL', () => {
    const parts = buildVisionImageParts(['https://i.ibb.co/x/a.png'], [DATA_URL])
    expect(parts).toEqual([{ type: 'image', image: 'iVBORw0KGgo=', mimeType: 'image/png' }])
  })

  // ImgBB 上传失败降级后 uploadedUrls 里就是 data URL
  it('ImgBB 上传失败降级为 data URL 时同样走 base64', () => {
    const parts = buildVisionImageParts([DATA_URL], [DATA_URL])
    expect(parts[0].image).toBe('iVBORw0KGgo=')
  })

  // 客户端直接传 URL 时无 base64 可用，退回 URL
  it('客户端直接传 URL 时用 URL 传入', () => {
    const parts = buildVisionImageParts([IMG_URL], [IMG_URL])
    expect(parts[0].image).toBeInstanceOf(URL)
    expect(String(parts[0].image)).toBe(IMG_URL)
  })

  // 形如 data:plain 的畸形输入拆不出载荷，原样传入
  it('无法解析 mimeType 的 data URL 原样传入', () => {
    const parts = buildVisionImageParts(['data:plain'], [undefined])
    expect(parts[0]).toEqual({ type: 'image', image: 'data:plain' })
  })

  // uploadedUrls 与 sourceImages 按下标配对
  it('多图按 index 一一对应并保持顺序', () => {
    const parts = buildVisionImageParts(
      ['https://i.ibb.co/x/a.png', 'https://i.ibb.co/x/b.png'],
      [DATA_URL, 'data:image/jpeg;base64,/9j/4AA=']
    )
    expect(parts).toHaveLength(2)
    expect(parts.map((p) => p.mimeType)).toEqual(['image/png', 'image/jpeg'])
    expect(parts.map((p) => p.image)).toEqual(['iVBORw0KGgo=', '/9j/4AA='])
  })
})
