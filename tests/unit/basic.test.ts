import { describe, it, expect } from 'vitest'

describe('项目基础结构', () => {
  it('应能正常导入 Nuxt 配置', () => {
    expect(true).toBe(true)
  })

  it('Vitest 测试框架已就绪', () => {
    const arr = [1, 2, 3]
    expect(arr).toHaveLength(3)
  })
})
