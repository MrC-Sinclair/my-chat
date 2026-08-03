/**
 * @file 语音消息 ASR 转写 API — POST /api/audio/transcribe
 *
 * Workflow 路径入口：前端录音结束后上传 WebM 音频，服务端转写为文本 + 情感 + 音频 URL
 *
 * 流程（详见 openspec/changes/add-voice-message-asr/design.md 决策 1、13）：
 *   1. multipart/form-data 接收音频文件，zod 校验大小（≤10MB）与 MIME（audio/*）
 *   2. 服务端重命名为 tmp-<uuid>.webm（防命令注入），用 ffmpeg 转码为 wav-<uuid>.wav
 *      （16kHz/16bit/mono/PCM + 清除元数据），WAV 仅用于 API 调用不落盘
 *   3. ffmpeg 重新封装原始 WebM 落盘到 server/uploads/audio/<timestamp>-<uuid>.webm（清除元数据）
 *   4. 通过 ffprobe 实测音频时长（不信任前端上报值）
 *   5. 调 SenseVoiceSmall → 检测语种标签命中 DIALECT_LANGUAGE_TAGS 时调 TeleSpeechASR 补强
 *   6. 成功 → 200 + { text, emotion, audioUrl, duration }
 *   7. 失败 → 500 + createError（不暴露内部 detail）
 *
 * 安全设计（决策 13）：
 *   - 全程不直接使用客户端上传文件名，统一用 UUID 重命名
 *   - child_process.spawnSync 数组参数（不 shell=true），防命令注入
 *   - 每请求独立 UUID 文件名（tmp-<uuid>.webm / wav-<uuid>.wav），防并发串扰
 *   - try/finally 无条件清理临时文件
 *
 * 部署限制：server/uploads/audio/ 依赖可写文件系统，仅本地/Docker 部署可用。
 * Vercel 等 Serverless 平台文件系统只读，路由层检测 process.env.VERCEL 返回明确错误。
 */
import { z } from 'zod'
import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  isFfmpegAvailable,
  transcribeWithSenseVoice,
  isSenseVoiceSuccess
} from '~/server/tools/sensevoice'
import {
  transcribeWithTeleSpeech,
  isTeleSpeechSuccess
} from '~/server/tools/telespeech'

// ============================================================================
// 常量与配置
// ============================================================================

/** 音频文件大小上限：10MB（与前端 MAX_RECORDING_DURATION=60s 配合，WebM/Opus 60s 约 200-500KB） */
const MAX_AUDIO_SIZE = 10 * 1024 * 1024

/** 允许的音频 MIME 类型前缀（audio/*） */
const ALLOWED_MIME_PREFIX = 'audio/'

/** 上传文件存放目录：server/uploads/audio/（不对外暴露，通过 API 路由代理访问） */
const AUDIO_UPLOAD_DIR = join(process.cwd(), 'server', 'uploads', 'audio')

/** 临时文件目录：os.tmpdir() 跨平台临时目录 */
const TMP_DIR = join(process.cwd(), 'tmp')

/** ffprobe 可用性缓存（与 ffmpeg 同源安装） */
let ffprobeAvailable: boolean | null = null

// ============================================================================
// 请求体 schema（任务 2.1）
// ============================================================================

/**
 * multipart/form-data 字段结构校验
 *
 * readMultipartFormData 返回每个字段为 { filename, data, type }，
 * 这里只校验单个 file 字段 + 可选 sessionId。
 */
const fileFieldSchema = z.object({
  filename: z.string().optional(),
  data: z.instanceof(Buffer).refine((buf) => buf.length > 0, '音频文件为空'),
  type: z
    .string()
    .optional()
    .refine((t) => !t || t.startsWith(ALLOWED_MIME_PREFIX), '文件类型必须是 audio/*')
})

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检测 ffprobe 是否可用（与 ffmpeg 同源安装）
 *
 * 任务 0.5：ffprobe 与 ffmpeg 同一安装包，用于实测音频时长（秒数）。
 * 探测结果模块级缓存，避免每次请求重复 spawn。
 */
function isFfprobeAvailable(): boolean {
  if (ffprobeAvailable !== null) return ffprobeAvailable
  try {
    const result = spawnSync('ffprobe', ['-version'], {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true
    })
    ffprobeAvailable = result.status === 0 && !result.error
  } catch {
    ffprobeAvailable = false
  }
  return ffprobeAvailable
}

/**
 * 通过 ffprobe 获取音频时长（秒）
 *
 * 任务 0.5：不信任前端上报值，服务端实测音频时长用于 UI 展示和 metadata 落库。
 * ffprobe 不可用时降级使用 ffmpeg -i 解析 stderr 中的 Duration 行。
 *
 * @param audioFilePath - 音频文件绝对路径
 * @returns 时长（秒），解析失败返回 0
 */
function getAudioDuration(audioFilePath: string): number {
  // 优先使用 ffprobe（更精确）
  if (isFfprobeAvailable()) {
    try {
      const result = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          audioFilePath
        ],
        {
          timeout: 5000,
          encoding: 'utf-8',
          windowsHide: true
        }
      )
      if (result.status === 0 && !result.error && result.stdout) {
        const duration = parseFloat(result.stdout.trim())
        if (!Number.isNaN(duration) && duration > 0) {
          return duration
        }
      }
    } catch {
      // ffprobe 失败，降级到 ffmpeg 解析
    }
  }

  // 降级方案：用 ffmpeg -i 解析 stderr 中的 Duration: HH:MM:SS.xx 行
  try {
    const result = spawnSync('ffmpeg', ['-i', audioFilePath], {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true
    })
    // ffmpeg 不带输出参数会以非 0 退出，但 stderr 包含文件信息
    const stderr = result.stderr || ''
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (match) {
      const hours = parseInt(match[1], 10)
      const minutes = parseInt(match[2], 10)
      const seconds = parseFloat(match[3])
      return hours * 3600 + minutes * 60 + seconds
    }
  } catch {
    // 解析失败，返回 0
  }

  return 0
}

/**
 * 安全删除文件（忽略不存在的文件和删除错误）
 */
function safeUnlink(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch {
    // 忽略清理错误（文件可能已被其他流程删除）
  }
}

// ============================================================================
// 主路由处理
// ============================================================================

export default defineEventHandler(async (event) => {
  // 部署兼容性检查：Vercel 等 Serverless 平台文件系统只读
  if (process.env.VERCEL) {
    throw createError({
      statusCode: 501,
      statusMessage: '语音消息功能在 Serverless 平台不可用，请使用本地或 Docker 部署'
    })
  }

  // 1. ffmpeg 可用性检查（决策 13）
  if (!isFfmpegAvailable()) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端未安装 ffmpeg，请联系管理员'
    })
  }

  // 2. 解析 multipart/form-data
  const formData = await readMultipartFormData(event)
  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: '未收到音频文件，请使用 multipart/form-data 上传'
    })
  }

  const fileField = formData.find((f) => f.name === 'file')
  if (!fileField) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少 file 字段'
    })
  }

  // 3. 字段校验（任务 2.1）
  const parsed = fileFieldSchema.safeParse(fileField)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    throw createError({
      statusCode: 400,
      statusMessage: firstError ? firstError.message : '音频文件参数无效'
    })
  }

  // 文件大小校验（readMultipartFormData 已读取完整 data 到内存，此处检查 Buffer 长度）
  if (parsed.data.data.length > MAX_AUDIO_SIZE) {
    throw createError({
      statusCode: 400,
      statusMessage: `音频文件大小超过限制（最多 ${MAX_AUDIO_SIZE / 1024 / 1024}MB）`
    })
  }

  // MIME 类型校验（type 字段可能缺失，结合 filename 扩展名兜底）
  const mimeType = parsed.data.type || 'audio/webm'
  if (!mimeType.startsWith(ALLOWED_MIME_PREFIX)) {
    throw createError({
      statusCode: 400,
      statusMessage: `文件类型必须是 audio/*，当前为 ${mimeType}`
    })
  }

  // 4. 确保目录存在
  if (!existsSync(AUDIO_UPLOAD_DIR)) {
    mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true })
  }
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true })
  }

  // 5. 生成每请求独立 UUID 文件名（防并发串扰，决策 13）
  const requestUuid = crypto.randomUUID()
  const timestamp = Date.now()
  const tmpWebmPath = join(TMP_DIR, `tmp-${requestUuid}.webm`)
  const tmpWavPath = join(TMP_DIR, `wav-${requestUuid}.wav`)
  // 落盘文件名：<timestamp>-<uuid>.webm（TTL 清理依据文件名中的时间戳，决策 2）
  const persistentWebmName = `${timestamp}-${requestUuid}.webm`
  const persistentWebmPath = join(AUDIO_UPLOAD_DIR, persistentWebmName)

  try {
    // 6. 保存原始 WebM 到 tmp 目录（任务 2.2 输入）
    writeFileSync(tmpWebmPath, parsed.data.data)

    // 7. ffmpeg 转码 WebM → WAV（任务 2.2）
    //    参数：-i 输入 / -acodec pcm_s16le 16bit PCM / -ar 16000 16kHz / -ac 1 mono
    //    / -map_metadata -1 清除元数据（防恶意元数据）
    //    spawnSync 数组参数（不 shell=true），防命令注入
    const convertResult = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        tmpWebmPath,
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-map_metadata',
        '-1',
        tmpWavPath
      ],
      { timeout: 30_000, encoding: 'utf-8', windowsHide: true }
    )

    if (convertResult.status !== 0 || !existsSync(tmpWavPath)) {
      const stderr = convertResult.stderr || ''
      console.error('[audio/transcribe] ffmpeg 转码失败:', {
        status: convertResult.status,
        stderr: stderr.slice(0, 500)
      })
      throw createError({
        statusCode: 500,
        statusMessage: '音频转码失败，请重试'
      })
    }

    // 8. ffmpeg 重新封装原始 WebM 落盘到 server/uploads/audio/（任务 2.3）
    //    -c copy 保持原编码不重新编码（性能优）+ -map_metadata -1 清除元数据
    //    防御客户端上传伪装 audio/webm 的恶意文件（嵌入 JS/HTML 或恶意元数据）
    const remuxResult = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        tmpWebmPath,
        '-c',
        'copy',
        '-map_metadata',
        '-1',
        persistentWebmPath
      ],
      { timeout: 30_000, encoding: 'utf-8', windowsHide: true }
    )

    if (remuxResult.status !== 0 || !existsSync(persistentWebmPath)) {
      const stderr = remuxResult.stderr || ''
      console.error('[audio/transcribe] ffmpeg 重新封装失败:', {
        status: remuxResult.status,
        stderr: stderr.slice(0, 500)
      })
      throw createError({
        statusCode: 500,
        statusMessage: '音频保存失败，请重试'
      })
    }

    // 9. 实测音频时长（任务 0.5 + 2.4）
    const duration = getAudioDuration(persistentWebmPath)

    // 10. 调用 SenseVoiceSmall 转写（任务 2.4 Workflow 第一步）
    const senseResult = await transcribeWithSenseVoice(tmpWavPath)
    if (!isSenseVoiceSuccess(senseResult)) {
      console.error('[audio/transcribe] SenseVoiceSmall 转写失败:', {
        error: senseResult.error,
        detail: senseResult.detail
      })
      throw createError({
        statusCode: 500,
        statusMessage: '语音转写失败，请重试'
      })
    }

    let finalText = senseResult.text
    const emotion = senseResult.emotion

    // 11. 方言场景补强：检测语种标签命中 DIALECT_LANGUAGE_TAGS 时调 TeleSpeechASR（任务 2.4 + 决策 4）
    const config = useRuntimeConfig()
    const dialectTagsRaw = config.dialectLanguageTags || 'yue'
    const dialectTags = new Set(
      dialectTagsRaw
        .split(',')
        .map((tag: string) => tag.trim().toLowerCase())
        .filter((tag: string) => tag.length > 0)
    )

    if (senseResult.language && dialectTags.has(senseResult.language.toLowerCase())) {
      const teleResult = await transcribeWithTeleSpeech(tmpWavPath)
      if (isTeleSpeechSuccess(teleResult) && teleResult.text.trim().length > 0) {
        // 取 TeleSpeechASR 结果（方言场景更优），失败则降级回 SenseVoiceSmall 结果
        finalText = teleResult.text.trim()
      }
      // TeleSpeechASR 失败时静默降级（已在 transcribeWithTeleSpeech 内部 console.warn）
    }

    // 12. 返回转写结果（任务 2.4 + 决策 3）
    //    audioUrl 为相对路径，前端通过 /api/audio/[id] 代理访问（决策 2）
    //    此处先用 /server/uploads/audio/<filename> 形式返回，后续可改为 API 路由代理
    return {
      text: finalText,
      emotion,
      audioUrl: `/api/audio/${persistentWebmName}`,
      duration
    }
  } catch (err) {
    // 任务 2.5：模型调用失败时 createError 500，console.error 记录原始错误，不暴露堆栈
    // createError 抛出的错误直接 rethrow（保留 statusCode 和 statusMessage）
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }
    console.error('[audio/transcribe] 转写流程异常:', err)
    throw createError({
      statusCode: 500,
      statusMessage: '语音转写失败，请重试'
    })
  } finally {
    // 任务 2.2 + 决策 13：try/finally 无条件清理临时文件
    // WAV 仅用于 API 调用，调用结束后立即清理（不落盘）
    // tmpWebmPath 已被 ffmpeg 重新封装为 persistentWebmPath，也可清理
    safeUnlink(tmpWebmPath)
    safeUnlink(tmpWavPath)
  }
})
