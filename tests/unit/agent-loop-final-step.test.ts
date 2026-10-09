/**
 * 最后一步收口的机制验证
 *
 * prepareFinalStep 的分支由 agent-loop.test.ts 覆盖，但那条只证明"返回值长这样"，
 * 不证明 `activeTools: []` 真的让模型在该步收不到工具定义——那才是方案一的承重假设。
 * 这里手写最小 LanguageModelV2 桩跑一次两步循环，直接断言第二次调用里工具集为空。
 * （不用 ai/test 的 MockLanguageModelV2：它 require 未安装的 msw，不该为一个断言引依赖。）
 */

import { describe, it, expect } from 'vitest'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { prepareFinalStep } from '~/server/utils/agent-loop'

/** 第一步要求调用工具，第二步只出文本；同时记录每次调用看到的工具名 */
function createSteppingModel(seen: string[][]) {
  let call = 0

  const model = {
    specificationVersion: 'v2' as const,
    provider: 'test',
    modelId: 'stepping',
    defaultObjectGenerationMode: undefined,
    doGenerate: async (args: { tools?: unknown }) => {
      // v2 里 args.tools 是函数工具数组（不是以名字为键的字典），取 name 断言
      const tools = args.tools
      seen.push(
        Array.isArray(tools)
          ? tools.map((t) => (t as { name?: string }).name ?? '')
          : Object.keys((tools as Record<string, unknown>) ?? {})
      )
      call += 1

      if (call === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'noop', input: '{}' }],
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1 }
        }
      }

      return {
        content: [{ type: 'text', text: '收尾回答' }],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    }
  }

  return model as never
}

describe('prepareFinalStep 在真实循环中的效果', () => {
  it('末步的模型调用不再携带任何工具', async () => {
    const maxStepCount = 2
    const seen: string[][] = []

    const result = await generateText({
      model: createSteppingModel(seen),
      prompt: '先调用工具再总结',
      stopWhen: stepCountIs(maxStepCount),
      prepareStep: ({ stepNumber }) => prepareFinalStep(stepNumber, maxStepCount) as never,
      tools: {
        noop: tool({
          description: '占位工具',
          inputSchema: z.object({}),
          execute: async () => ({ ok: true })
        })
      }
    })

    expect(seen[0]).toContain('noop')
    expect(seen.at(-1)).toEqual([])
    expect(result.text).toBe('收尾回答')
  })
})
