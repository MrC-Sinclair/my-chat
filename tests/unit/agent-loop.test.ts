/**
 * Agent 循环最后一步收口测试
 *
 * 关注点：只有最后一步收回工具，且无工具场景（maxStepCount=1）不受影响
 */

import { describe, it, expect } from 'vitest'
import { prepareFinalStep } from '~/server/utils/agent-loop'

describe('prepareFinalStep', () => {
  it('前几步沿用外层设置，不收回工具', () => {
    expect(prepareFinalStep(0, 5)).toBeUndefined()
    expect(prepareFinalStep(1, 5)).toBeUndefined()
    expect(prepareFinalStep(3, 5)).toBeUndefined()
  })

  it('最后一步收回所有工具', () => {
    expect(prepareFinalStep(4, 5)).toEqual({ activeTools: [] })
  })

  it('步序号越过上限时仍保持收回，避免多出的调用把这一轮再次掏空', () => {
    expect(prepareFinalStep(7, 5)).toEqual({ activeTools: [] })
  })

  it('两步循环时第 2 步收回、第 1 步不收回', () => {
    expect(prepareFinalStep(0, 2)).toBeUndefined()
    expect(prepareFinalStep(1, 2)).toEqual({ activeTools: [] })
  })

  it('无工具循环（上限 1 步）不做任何干预', () => {
    expect(prepareFinalStep(0, 1)).toBeUndefined()
  })
})
