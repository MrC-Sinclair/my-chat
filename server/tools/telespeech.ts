/**
 * @file TeleSpeechASR 方言 ASR 模型调用封装 + 端点可用性探测
 *
 * 封装 TeleAI/TeleSpeechASR 模型调用，专攻方言场景转写（支持 60 种方言自由混说）。
 * 仅在 SenseVoiceSmall 检测到方言语种标签且端点可用性探测通过时由 Workflow 调用，
 * 不独立暴露给 LLM。
 *
 * 设计要点（详见 openspec/changes/add-voice-message-asr/design.md 决策 4）：
 *   - SiliconFlow 官方 API 文档**未列出** TeleAI/TeleSpeechASR 模型，需运行时探测端点可用性
 *   - 探测样本：模块加载时用 ffmpeg 生成 1 秒静音 WAV，缓存到模块级变量
 *   - 探测结果缓存到 teleSpeechAvailable，避免每次请求重复探测
 *   - 探测失败则自动降级为仅 SenseVoiceSmall 单独转写，不报错、不影响主流程
 *   - 调用失败返回 { error, detail } 不 throw（Workflow 降级回 SenseVoiceSmall 结果）
 */
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { isFfmpegAvailable } from './sensevoice'

/** 硅基流动 TeleSpeechASR 模型名 */
const TELESPEECH_MODEL = 'TeleAI/TeleSpeechASR'

// ============================================================================
// 端点可用性探测（任务 2.4.1）
// ============================================================================

/**
 * TeleSpeechASR 端点可用性探测结果缓存（模块级）
 *
 * null = 未探测；true = 端点可用；false = 端点不可用（降级）
 * 首次调用 transcribeWithTeleSpeech 前探测，结果进程内缓存。
 */
let teleSpeechAvailable: boolean | null = null

/**
 * 探测用静音 WAV 音频样本（1 秒，16kHz/mono/PCM）
 *
 * 模块加载时通过 ffmpeg 生成，缓存到模块级变量避免每次探测重复生成。
 * 若 ffmpeg 不可用，此处为 null，探测直接返回 false 并降级。
 */
let probeAudioBuffer: Buffer | null = null

/**
 * 模块加载时生成探测用静音 WAV 样本
 *
 * 使用 ffmpeg lavfi 生成 1 秒静音 WAV（16kHz/mono/PCM），
 * 通过 stdout 捕获为 Buffer，避免临时文件管理。
 *
 * 生成失败（ffmpeg 不可用或命令异常）时 probeAudioBuffer 保持 null，
 * 后续探测直接返回 false 并降级，不影响服务启动。
 */
function generateProbeAudio(): void {
  if (!isFfmpegAvailable()) {
    // ffmpeg 不可用，跳过样本生成，后续探测直接返回 false
    return
  }

  try {
    const result = spawnSync(
      'ffmpeg',
      [
        '-f', 'lavfi',
        '-i', 'anullsrc=r=16000:cl=mono',
        '-t', '1',
        '-c', 'pcm_s16le',
        '-f', 'wav',
        'pipe:1'
      ],
      {
        encoding: null, // 返回 Buffer 而非字符串
        timeout: 5000,
        windowsHide: true
      }
    )

    if (result.status === 0 && result.stdout && result.stdout.length > 0) {
      probeAudioBuffer = result.stdout
    }
  } catch {
    // 生成失败，probeAudioBuffer 保持 null，后续探测降级
  }
}

// 模块加载时生成探测样本（非阻塞，失败不影响服务启动）
generateProbeAudio()

/**
 * 探测 TeleSpeechASR 端点可用性
 *
 * 用静音 WAV 样本调用 POST /v1/audio/transcriptions model=TeleAI/TeleSpeechASR：
 *   - HTTP 200 → 端点可用，缓存 true
 *   - 404/400/其他 → 端点不可用，缓存 false（自动降级为仅 SenseVoiceSmall）
 *
 * @returns true 表示端点可用；false 表示不可用（降级）
 */
async function probeTeleSpeechEndpoint(): Promise<boolean> {
  const config = useRuntimeConfig()
  const apiKey = config.openAiApiKey
  const baseUrl = config.openAiBaseUrl

  // 配置缺失或探测样本未生成，直接降级
  if (!apiKey || !baseUrl || !probeAudioBuffer) {
    return false
  }

  try {
    // 用 Uint8Array 包装 Buffer，规避 TS 严格模式下类型问题（同 sensevoice.ts）
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(probeAudioBuffer)]), 'probe.wav')
    formData.append('model', TELESPEECH_MODEL)

    const url = `${baseUrl}/audio/transcriptions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    })

    // HTTP 200 表示端点可用；404/400 表示模型不存在，其他错误也视为不可用
    return response.ok
  } catch {
    // 网络异常视为不可用
    return false
  }
}

/**
 * 获取 TeleSpeechASR 端点可用性（带缓存）
 *
 * 首次调用触发探测，后续直接返回缓存结果。
 * 探测失败（端点不可用）时 console.warn 记录降级信息。
 *
 * @returns true 表示端点可用，可调用 TeleSpeechASR；false 表示不可用，应降级
 */
export async function isTeleSpeechAvailable(): Promise<boolean> {
  // 已探测过，直接返回缓存结果
  if (teleSpeechAvailable !== null) return teleSpeechAvailable

  // 首次探测
  teleSpeechAvailable = await probeTeleSpeechEndpoint()

  if (!teleSpeechAvailable) {
    console.warn(
      '[telespeech] TeleSpeechASR 端点不可用，已降级为仅 SenseVoiceSmall 单独转写'
    )
  }

  return teleSpeechAvailable
}

// ============================================================================
// TeleSpeechASR 模型调用
// ============================================================================

/**
 * TeleSpeechASR 转写成功结果（仅文本，不输出情感）
 */
export interface TeleSpeechSuccess {
  text: string
}

/**
 * TeleSpeechASR 转写失败结果
 *
 * 不 throw 异常，由 Workflow 调用方通过 'detail' 字段判断失败并降级回 SenseVoiceSmall。
 */
export interface TeleSpeechFailure {
  /** 错误类型标识（如 endpoint_unavailable/api_error/network_error） */
  error: string
  /** 错误详情（供日志排查，不暴露给客户端） */
  detail: string
}

/** TeleSpeechASR 转写结果（成功或失败联合类型） */
export type TeleSpeechResult = TeleSpeechSuccess | TeleSpeechFailure

/**
 * 类型守卫：判断转写结果是否为成功
 */
export function isTeleSpeechSuccess(
  result: TeleSpeechResult
): result is TeleSpeechSuccess {
  return !('error' in result)
}

/**
 * 调用 TeleSpeechASR 转写音频文件（方言场景）
 *
 * 通过硅基流动 /v1/audio/transcriptions 端点（OpenAI 兼容格式），
 * 以 multipart/form-data 上传音频文件，返回 { text: "纯文本" }。
 *
 * **前置条件**：端点可用性探测通过（isTeleSpeechAvailable() 返回 true）。
 * 若探测未通过，直接返回 endpoint_unavailable 错误，由 Workflow 降级。
 *
 * @param audioFilePath - 音频文件绝对路径（WAV 格式，16kHz/16bit/mono/PCM）
 * @returns 成功返回 { text }；失败返回 { error, detail }
 *
 * 错误处理（不 throw，返回结构化错误对象）：
 *   - endpoint_unavailable: 端点可用性探测未通过，应降级回 SenseVoiceSmall
 *   - config_missing: 服务端未配置 API Key 或 Base URL
 *   - file_read_error: 音频文件读取失败
 *   - api_error: 模型 API 返回非 200 状态码
 *   - empty_response: API 返回空文本
 *   - network_error: 网络异常或超时
 */
export async function transcribeWithTeleSpeech(
  audioFilePath: string
): Promise<TeleSpeechResult> {
  // 前置条件：端点可用性探测
  const available = await isTeleSpeechAvailable()
  if (!available) {
    return {
      error: 'endpoint_unavailable',
      detail: 'TeleSpeechASR 端点不可用，已降级为仅 SenseVoiceSmall'
    }
  }

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
    // 用 Uint8Array 包装 Buffer，规避 TS 严格模式下类型问题（同 sensevoice.ts）
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(fileBuffer)]), basename(audioFilePath))
    formData.append('model', TELESPEECH_MODEL)

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
        detail: `TeleSpeechASR API 返回 ${response.status}: ${detail.slice(0, 200)}`
      }
    }

    const data = (await response.json()) as { text?: string }
    if (!data.text || typeof data.text !== 'string') {
      return {
        error: 'empty_response',
        detail: 'TeleSpeechASR 返回空文本或格式异常'
      }
    }

    // TeleSpeechASR 输出纯文本（无标签），直接返回
    return { text: data.text.trim() }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      error: 'network_error',
      detail: `TeleSpeechASR 调用异常: ${msg}`
    }
  }
}
