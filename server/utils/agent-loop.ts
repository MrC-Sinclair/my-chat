/**
 * @file Agent 循环的最后一步收口策略
 *
 * 为什么需要：`stopWhen: stepCountIs(5)` 是硬上限，小模型把步数耗在被拒绝的工具调用上时，
 * 第 5 步结束时可能一个字都没输出，于是这一轮只有工具卡、没有回答；又因为空文本不落库，
 * 用户重开会话只会看到自己的提问凭空没有回应（线上实测发生过）。
 *
 * 做法：最后一步不给它任何可用工具（`activeTools: []`），模型只能基于已有的工具结果生成文本。
 * 不选 `toolChoice: 'none'`：那会把工具 schema 继续发给供应商，而部分 OpenAI 兼容端点对
 * `tool_choice` 的取值支持不一致，曾因多传参数直接返回 400。
 */

/** 最后一步的步配置；非最后一步返回 undefined，沿用 streamText 外层设置 */
export function prepareFinalStep(
  stepNumber: number,
  maxStepCount: number
): { activeTools: [] } | undefined {
  if (maxStepCount < 2) return undefined
  return stepNumber >= maxStepCount - 1 ? { activeTools: [] } : undefined
}
