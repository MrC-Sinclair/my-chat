/**
 * 模型配置 API 测试
 *
 * 测试 /api/models 接口及 server/config/models.ts 中的配置逻辑：
 * - AVAILABLE_MODELS 白名单完整性
 * - getModelCapabilities 能力查询
 * - ALLOWED_MODEL_VALUES 校验集合
 *
 * 说明：models.ts 是纯函数，无数据库依赖，可直接测试
 */

import { describe, it, expect } from 'vitest'
import {
  AVAILABLE_MODELS,
  ALLOWED_MODEL_VALUES,
  getModelCapabilities
} from '~/server/config/models'

describe('模型配置 server/config/models.ts', () => {
  describe('AVAILABLE_MODELS 白名单', () => {
    it('应包含至少 3 个模型', () => {
      expect(AVAILABLE_MODELS.length).toBeGreaterThanOrEqual(3)
    })

    it('每个模型应有 label、value、capabilities 三个字段', () => {
      AVAILABLE_MODELS.forEach((model) => {
        expect(model).toHaveProperty('label')
        expect(model).toHaveProperty('value')
        expect(model).toHaveProperty('capabilities')
        expect(typeof model.label).toBe('string')
        expect(typeof model.value).toBe('string')
        expect(model.label.length).toBeGreaterThan(0)
        expect(model.value.length).toBeGreaterThan(0)
      })
    })

    it('每个模型的 capabilities 应包含 vision、deepThinking、toolCalling', () => {
      AVAILABLE_MODELS.forEach((model) => {
        expect(model.capabilities).toHaveProperty('vision')
        expect(model.capabilities).toHaveProperty('deepThinking')
        expect(model.capabilities).toHaveProperty('toolCalling')
        expect(typeof model.capabilities.vision).toBe('boolean')
        expect(typeof model.capabilities.deepThinking).toBe('boolean')
        expect(typeof model.capabilities.toolCalling).toBe('boolean')
      })
    })

    it('模型 value 应唯一', () => {
      const values = AVAILABLE_MODELS.map((m) => m.value)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)
    })
  })

  describe('ALLOWED_MODEL_VALUES 校验集合', () => {
    it('应包含所有 AVAILABLE_MODELS 的 value', () => {
      AVAILABLE_MODELS.forEach((model) => {
        expect(ALLOWED_MODEL_VALUES.has(model.value)).toBe(true)
      })
    })

    it('未在白名单中的模型值应返回 false', () => {
      expect(ALLOWED_MODEL_VALUES.has('invalid/model-name')).toBe(false)
      expect(ALLOWED_MODEL_VALUES.has('')).toBe(false)
    })
  })

  describe('getModelCapabilities 能力查询', () => {
    it('查询存在的模型应返回其能力配置', () => {
      const qwenModel = AVAILABLE_MODELS.find((m) => m.value === 'Qwen/Qwen3-8B')
      expect(qwenModel).toBeDefined()
      const caps = getModelCapabilities('Qwen/Qwen3-8B')
      expect(caps).toEqual(qwenModel!.capabilities)
    })

    it('查询不存在的模型应返回默认能力（无视觉、无推理、支持工具调用）', () => {
      const caps = getModelCapabilities('nonexistent/model')
      expect(caps.vision).toBe(false)
      expect(caps.deepThinking).toBe(false)
      expect(caps.toolCalling).toBe(true)
    })

    it('查询空字符串应返回默认能力', () => {
      const caps = getModelCapabilities('')
      expect(caps.vision).toBe(false)
      expect(caps.toolCalling).toBe(true)
    })

    it('视觉模型应正确返回 vision: true', () => {
      const visionModel = AVAILABLE_MODELS.find((m) => m.capabilities.vision === true)
      expect(visionModel).toBeDefined()
      const caps = getModelCapabilities(visionModel!.value)
      expect(caps.vision).toBe(true)
    })

    it('深度思考模型应正确返回 deepThinking: true', () => {
      const thinkingModel = AVAILABLE_MODELS.find((m) => m.capabilities.deepThinking === true)
      expect(thinkingModel).toBeDefined()
      const caps = getModelCapabilities(thinkingModel!.value)
      expect(caps.deepThinking).toBe(true)
    })
  })
})
