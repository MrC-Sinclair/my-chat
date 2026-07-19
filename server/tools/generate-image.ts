/**
 * @file generate-image 工具 — 文生图 Agent 工具
 *
 * 设计要点（详见 openspec/changes/add-image-generation/design.md）：
 *   - 作为 Agent 工具注册到 chat.post.ts 的 toolsConfig
 *   - 由 LLM 自主决定调用时机（Agent 路径）
 *   - 复用 server/utils/image-generation.ts 的 generateImageWithPersistence
 *   - 错误返回不抛异常，遵循项目工具错误返回模式（参考 recall-memory.ts）
 *   - 返回结构化对象 { imageUrl, markdown, seed, inferenceTime, ...(warning?) }，
 *     遵循「大对象通过 URL/ID 传递，不进 LLM 上下文」项目规范
 */
import { tool } from 'ai'
import { z } from 'zod'
import {
  generateImageWithPersistence,
  IMAGE_SIZES,
  type ImageSize
} from '~/server/utils/image-generation'

/**
 * generateImage 工具：调用 Kwai-Kolors/Kolors 生成图片
 *
 * 调用场景（何时调用）：
 *   - 用户明确请求生成图片：「画一只猫」「生成图片」「绘制」「画一张」「给我画」「能画吗」「帮我画」
 *
 * 禁止场景（何时不调用）：
 *   - 用户只要文字回答、解释、描述
 *   - 用户上传图片要求识别/分析（这是 OCR 工具的职责）
 *   - 用户描述一个场景但未要求生成图片
 *
 * Prompt 撰写建议：
 *   - 英文 prompt 对 Kolors 效果更佳；如用户用中文描述，先翻译为英文再调用
 *   - 包含：主体（subject）+ 风格（style）+ 场景/背景（setting）+ 关键细节
 *   - 例：用户说"画一只在月亮下的白猫" → prompt = "A white cat under the moonlight,
 *     soft illustration style, starry night sky background, peaceful and dreamy atmosphere"
 */
export const generateImageTool = tool({
  description: `生成图片（文生图）。当用户明确请求生成图片时调用此工具，典型触发词：「画」「生成图片」「绘制」「画一张」「给我画」「能画吗」「帮我画」。调用后会返回图片 URL 和 markdown 图片语法，你应该在回答中用 markdown 图片语法 \`![描述](imageUrl)\` 嵌入图片。

不要在以下场景调用：
- 用户只要文字回答、解释、描述（如「解释什么是 SSRF」）
- 用户上传图片要求识别/分析（这是 OCR 工具的职责，不是生图工具）
- 用户描述一个场景但未要求生成图片（如「想象一下夕阳下的海边」只是文字描述，不是要求画图）

Prompt 撰写建议：
- 英文 prompt 对 Kolors 效果更佳；如用户用中文描述，先翻译为英文再调用
- 包含：主体（subject）+ 风格（style）+ 场景/背景（setting）+ 关键细节
- 例：用户说"画一只在月亮下的白猫" → prompt = "A white cat under the moonlight, soft illustration style, starry night sky background, peaceful and dreamy atmosphere"`,
  inputSchema: z.object({
    prompt: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        '图片生成的英文 prompt，包含主体 + 风格 + 场景 + 关键细节。如用户用中文描述，先翻译为英文再传入。长度 1-2000 字符'
      ),
    seed: z
      .number()
      .int()
      .min(0)
      .max(9999999999)
      .optional()
      .describe(
        '随机种子（可选）。同一 seed + 同一 prompt 会生成相似图片，用于可复现。范围 0-9999999999'
      ),
    imageSize: z
      .enum(IMAGE_SIZES)
      .optional()
      .describe(
        '图片尺寸（可选）。可选值：1024x1024（1:1 正方形，默认）、960x1280（3:4 竖屏）、768x1024（3:4 经典竖屏）、720x1440（1:2 超长竖屏，手机壁纸）、720x1280（9:16 竖屏）'
      )
  }),
  execute: async ({ prompt, seed, imageSize }) => {
    const params: { prompt: string; seed?: number; imageSize?: ImageSize } = {
      prompt
    }
    if (seed !== undefined) {
      params.seed = seed
    }
    if (imageSize !== undefined) {
      params.imageSize = imageSize
    }

    // generateImageWithPersistence 已封装错误处理（不抛异常），直接透传返回
    const result = await generateImageWithPersistence(params)

    // 类型守卫：'detail' 字段仅在 GenerateImageFailure 中存在（参考 recall-memory.ts 同款模式）
    // 不能用 'error' in result：GenerateImageSuccess 有 error?: never，TS 不会收窄
    if ('detail' in result) {
      return {
        error: result.error,
        detail: result.detail,
        query: result.query
      }
    }

    // 成功分支：透传 imageUrl / markdown / seed / inferenceTime / warning
    return {
      imageUrl: result.imageUrl,
      markdown: result.markdown,
      seed: result.seed,
      inferenceTime: result.inferenceTime,
      ...(result.warning !== undefined && { warning: result.warning })
    }
  }
})
