/**
 * @file SenseVoiceSmall ASR 模型调用封装 + ffmpeg 可用性探测
 *
 * 封装 FunAudioLLM/SenseVoiceSmall 模型调用，通过硅基流动 /v1/audio/transcriptions
 * 端点转写音频文件，并解析返回的富文本标签（情感/语种/事件），输出结构化结果。
 *
 * 设计要点（详见 openspec/changes/add-voice-message-asr/design.md 决策 10）：
 *   - 调用失败返回 { error, detail } 不 throw（由 Workflow 调用方决定降级策略）
 *   - 标签提取统一使用 /<\|\s*([A-Za-z0-9_]+)\s*\|>/g，情感/语种/事件标签大小写均可匹配
 *   - 纯文本清洗使用 /<\|[^|]+\|>/g 移除所有 <|...|> 标签
 *   - 情感标签仅 HAPPY/SAD/ANGRY/NEUTRAL 映射到白名单，其他情感标签（含 EMO_UNKNOWN）归为 null
 *
 * SenseVoice 富文本标签体系（基于 FunASR 源码 postprocess_utils.py）：
 *   - 情感（8 种）：HAPPY/SAD/ANGRY/NEUTRAL/EMO_UNKNOWN/FEARFUL/DISGUSTED/SURPRISED
 *   - 语种（6 种）：zh/en/yue/ja/ko/nospeech
 *   - 事件（8 种）：BGM/Speech/Applause/Laughter/Cry/Sneeze/Breath/Cough
 */
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

// ============================================================================
// ffmpeg 可用性探测（任务 0.4）
// ============================================================================

/**
 * ffmpeg 可用性探测结果缓存（模块级）
 *
 * null = 未探测；true = 可用；false = 不可用
 * 首次调用 spawnSync('ffmpeg', ['-version']) 后缓存，避免每次请求重复探测。
 */
let ffmpegAvailable: boolean | null = null

/**
 * 探测 ffmpeg 是否安装并可在 PATH 中找到
 *
 * 跨平台实现：spawnSync 直接 spawn 可执行文件，无需 which/where。
 * Windows 上自动查找 PATH 中的 ffmpeg.exe（实测 8.1.1 mingw32 静态构建可用）。
 *
 * @returns true 表示 ffmpeg 可用；false 表示未安装或不在 PATH
 */
export function isFfmpegAvailable(): boolean {
  // 已探测过，直接返回缓存结果
  if (ffmpegAvailable !== null) return ffmpegAvailable

  try {
    // 超时 5 秒，防止极端情况下挂起
    const result = spawnSync('ffmpeg', ['-version'], {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true
    })
    // 退出码 0 表示 ffmpeg 可执行
    ffmpegAvailable = result.status === 0 && !result.error
  } catch {
    // spawnSync 抛异常（如 ENOENT）表示未安装
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

// ============================================================================
// SenseVoice 富文本标签解析
// ============================================================================

/** 硅基流动 SenseVoiceSmall 模型名 */
const SENSEVOICE_MODEL = 'FunAudioLLM/SenseVoiceSmall'

/**
 * 情感标签映射表（原始标签 → 白名单值或 null）
 *
 * 仅 HAPPY/SAD/ANGRY/NEUTRAL 映射到白名单值，供系统提示注入与 UI 展示。
 * 其他情感标签（EMO_UNKNOWN/FEARFUL/DISGUSTED/SURPRISED）归为 null，
 * 不注入系统提示、不展示情感标签（MVP 阶段保守策略）。
 *
 * 标签统一用大写形式作为 key（正则提取后 toUpperCase 匹配），
 * 因为 SenseVoice 情感标签大小写不统一（HAPPY 大写，但旧文档误写 emo_unk）。
 */
const EMOTION_MAP: Record<string, 'happy' | 'sad' | 'angry' | 'neutral' | null> = {
  HAPPY: 'happy',
  SAD: 'sad',
  ANGRY: 'angry',
  NEUTRAL: 'neutral',
  EMO_UNKNOWN: null,
  FEARFUL: null,
  DISGUSTED: null,
  SURPRISED: null
}

/**
 * 语种标签集合（小写，SenseVoice 官方 6 种语种）
 *
 * 官方 language 参数枚举：zh/en/yue/ja/ko/nospeech
 * 注意：nan（闽南语）/wuu（吴语）不是 SenseVoice 原生输出标签，
 * 方言音频会被归类为 zh 或 yue。
 */
const LANGUAGE_SET = new Set(['zh', 'en', 'yue', 'ja', 'ko', 'nospeech'])

/**
 * 事件标签集合（小写形式，用于大小写不敏感匹配）
 *
 * FunASR 源码 event_dict 定义 8 种事件标签，原始形式大小写不统一：
 * BGM（全大写）、Speech/Applause/Laughter/Cry/Sneeze/Breath/Cough（首字母大写）
 * 匹配时统一转小写，输出保留原始标签。
 */
const EVENT_SET_LOWER = new Set([
  'bgm',
  'speech',
  'applause',
  'laughter',
  'cry',
  'sneeze',
  'breath',
  'cough'
])

/**
 * 标签提取正则：匹配 <|...|> 形式的标签，捕获标签名
 *
 * \s* 容忍标签内空格（如 <| HAPPY |>），[A-Za-z0-9_]+ 覆盖大小写字母/数字/下划线
 * 全局标志 g 用于 exec 循环提取所有标签
 */
const TAG_REGEX = /<\|\s*([A-Za-z0-9_]+)\s*\|>/g

/**
 * 纯文本清洗正则：移除所有 <|...|> 标签（包括含特殊字符的标签）
 *
 * [^|]+ 匹配 | 之间的任意非 | 字符，比标签提取正则更宽松，
 * 确保所有标签（含未识别格式）都被清除
 */
const CLEAN_TEXT_REGEX = /<\|[^|]+\|>/g

/**
 * SenseVoice 转写成功结果
 */
export interface SenseVoiceSuccess {
  /** 清洗标签后的纯文本 */
  text: string
  /** 情感标签（仅 happy/sad/angry/neutral 或 null） */
  emotion: 'happy' | 'sad' | 'angry' | 'neutral' | null
  /** 语种标签（zh/en/yue/ja/ko/nospeech 或 null） */
  language: string | null
  /** 音频事件标签列表（保留原始大小写） */
  events: string[]
}

/**
 * SenseVoice 转写失败结果
 *
 * 不 throw 异常，由调用方通过 'detail' 字段判断失败并决定降级策略。
 */
export interface SenseVoiceFailure {
  /** 错误类型标识（如 api_error/network_error/empty_response） */
  error: string
  /** 错误详情（供日志排查，不暴露给客户端） */
  detail: string
}

/** SenseVoice 转写结果（成功或失败联合类型） */
export type SenseVoiceResult = SenseVoiceSuccess | SenseVoiceFailure

/**
 * 类型守卫：判断转写结果是否为成功
 */
export function isSenseVoiceSuccess(
  result: SenseVoiceResult
): result is SenseVoiceSuccess {
  return !('error' in result)
}

/**
 * 解析 SenseVoice 富文本标签，分离纯文本与结构化标签
 *
 * @param rawText - API 返回的原始文本（含 <|...|> 标签）
 * @returns 结构化结果：{ text, emotion, language, events }
 *
 * 解析逻辑：
 *   1. 用 TAG_REGEX 提取所有标签名
 *   2. 按类型分类：情感（大写匹配 EMOTION_MAP）、语种（小写匹配 LANGUAGE_SET）、事件（小写匹配 EVENT_SET_LOWER）
 *   3. 用 CLEAN_TEXT_REGEX 移除所有标签，得到纯文本
 *
 * 注意：同一类型多个标签时，后出现的标签覆盖前者（实际场景中同类型标签不会重复）
 */
function parseSenseVoiceTags(rawText: string): {
  text: string
  emotion: 'happy' | 'sad' | 'angry' | 'neutral' | null
  language: string | null
  events: string[]
} {
  const tags: string[] = []
  let match: RegExpExecArray | null

  // 重置 lastIndex（全局正则复用安全）
  TAG_REGEX.lastIndex = 0
  while ((match = TAG_REGEX.exec(rawText)) !== null) {
    tags.push(match[1])
  }

  let emotion: 'happy' | 'sad' | 'angry' | 'neutral' | null = null
  let language: string | null = null
  const events: string[] = []

  for (const tag of tags) {
    // 情感标签：大写形式匹配 EMOTION_MAP
    const upperTag = tag.toUpperCase()
    if (upperTag in EMOTION_MAP) {
      emotion = EMOTION_MAP[upperTag]
      continue
    }

    // 语种标签：小写形式匹配 LANGUAGE_SET
    const lowerTag = tag.toLowerCase()
    if (LANGUAGE_SET.has(lowerTag)) {
      language = lowerTag
      continue
    }

    // 事件标签：小写形式匹配 EVENT_SET_LOWER，输出保留原始标签
    if (EVENT_SET_LOWER.has(lowerTag)) {
      events.push(tag)
    }
  }

  // 清洗所有标签得到纯文本
  const text = rawText.replace(CLEAN_TEXT_REGEX, '').trim()

  return { text, emotion, language, events }
}

// ============================================================================
// SenseVoiceSmall 模型调用
// ============================================================================

/**
 * 调用 SenseVoiceSmall 转写音频文件
 *
 * 通过硅基流动 /v1/audio/transcriptions 端点（OpenAI 兼容格式），
 * 以 multipart/form-data 上传音频文件，返回 { text: "富文本转录" }。
 *
 * @param audioFilePath - 音频文件绝对路径（WAV 格式，16kHz/16bit/mono/PCM）
 * @returns 成功返回 { text, emotion, language, events }；失败返回 { error, detail }
 *
 * 错误处理（不 throw，返回结构化错误对象）：
 *   - config_missing: 服务端未配置 API Key 或 Base URL
 *   - file_read_error: 音频文件读取失败
 *   - api_error: 模型 API 返回非 200 状态码
 *   - empty_response: API 返回空文本
 *   - network_error: 网络异常或超时
 *
 * 示例：
 *   await transcribeWithSenseVoice('/tmp/wav-xxx.wav')
 *   → { text: "你好世界", emotion: "happy", language: "zh", events: [] }
 */
export async function transcribeWithSenseVoice(
  audioFilePath: string
): Promise<SenseVoiceResult> {
  const config = useRuntimeConfig()
  const apiKey = config.openAiApiKey
  const baseUrl = config.openAiBaseUrl

  if (!apiKey || !baseUrl) {
    return {
      error: 'config_missing',
      detail: '服务端未配置 OPENAI_API_KEY 或 OPENAI_BASE_URL'
    }
  }

  // 读取音频文件
  let fileBuffer: Buffer
  try {
    fileBuffer = await readFile(audioFilePath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      error: 'file_read_error',
      detail: `音频文件读取失败: ${msg}`
    }
  }

  try {
    // 构造 multipart/form-data 请求（OpenAI 兼容格式）
    // 用 Uint8Array 包装 Buffer，规避 TS 严格模式下 Buffer<ArrayBufferLike>
    // 不可赋值给 BlobPart 的类型问题（Buffer 继承自 Uint8Array，运行时等价）
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(fileBuffer)]), basename(audioFilePath))
    formData.append('model', SENSEVOICE_MODEL)

    const url = `${baseUrl}/audio/transcriptions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        error: 'api_error',
        detail: `SenseVoiceSmall API 返回 ${response.status}: ${detail.slice(0, 200)}`
      }
    }

    const data = (await response.json()) as { text?: string }
    if (!data.text || typeof data.text !== 'string') {
      return {
        error: 'empty_response',
        detail: 'SenseVoiceSmall 返回空文本或格式异常'
      }
    }

    // 解析富文本标签，返回结构化结果
    return parseSenseVoiceTags(data.text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      error: 'network_error',
      detail: `SenseVoiceSmall 调用异常: ${msg}`
    }
  }
}
