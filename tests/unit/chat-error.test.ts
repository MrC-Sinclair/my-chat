/**
 * 对话错误文案整理测试
 *
 * 关注点：服务端错误 JSON 不得整段暴露给用户，同时纯文本错误要原样保留
 */

import { describe, it, expect } from 'vitest'
import { formatChatError } from '~/utils/chat-error'

describe('formatChatError', () => {
  it('限流错误体只取 message 字段', () => {
    const raw = '{"statusCode":429,"message":"请求过于频繁，请稍后再试"}'

    expect(formatChatError(raw)).toBe('请求过于频繁，请稍后再试')
  })

  it('无 message 时依次回退 statusMessage、error', () => {
    expect(formatChatError('{"statusCode":500,"statusMessage":"服务内部错误"}')).toBe(
      '服务内部错误'
    )
    expect(formatChatError('{"statusCode":500,"error":"网关超时"}')).toBe('网关超时')
  })

  it('纯文本错误原样返回，不改写内容', () => {
    expect(formatChatError('Failed to fetch')).toBe('Failed to fetch')
  })

  it('空值返回「未知错误」', () => {
    expect(formatChatError('')).toBe('未知错误')
    expect(formatChatError(undefined)).toBe('未知错误')
    expect(formatChatError('   ')).toBe('未知错误')
  })

  it('可读字段为空串时不返回空文案', () => {
    expect(formatChatError('{"message":"  ","statusMessage":"服务不可用"}')).toBe('服务不可用')
  })

  it('以 { 开头但不是合法 JSON 时按原文展示', () => {
    expect(formatChatError('{not json')).toBe('{not json')
  })

  it('JSON 数组或无可读字段时保留原文', () => {
    expect(formatChatError('[1,2,3]')).toBe('[1,2,3]')
    expect(formatChatError('{"code":"ECONN"}')).toBe('{"code":"ECONN"}')
  })
})
