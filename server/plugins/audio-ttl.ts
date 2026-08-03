/**
 * @file 音频文件 TTL 自动清理 plugin
 *
 * 任务 2.6：定期扫描 server/uploads/audio/，删除超过 7 天的音频文件。
 *
 * 设计要点（详见 openspec/changes/add-voice-message-asr/design.md 决策 2）：
 *   - 使用文件名中的时间戳（`<timestamp>-<uuid>.webm`）判断过期，不使用 mtime
 *     原因：文件系统操作（备份、杀毒扫描）可能更新 mtime 导致文件永不过期
 *   - 文件名格式严格校验（与 /api/audio/[id].get.ts 一致），避免误删
 *   - Nuxt server plugin 在 nitro 启动时加载，setInterval 定时扫描
 *   - 进程退出时清理定时器，避免句柄泄漏
 *
 * 部署限制：与 transcribe.post.ts 一致，Vercel 等 Serverless 平台不启动定时器。
 */
import { readdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 音频文件存放目录 */
const AUDIO_UPLOAD_DIR = join(process.cwd(), 'server', 'uploads', 'audio')

/** TTL 过期时间：7 天（毫秒） */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 扫描间隔：每小时扫描一次（避免过频 IO，过期 1 小时内清理可接受） */
const SCAN_INTERVAL_MS = 60 * 60 * 1000

/**
 * 文件名格式：<timestamp>-<uuid>.webm
 *
 * 与 /api/audio/[id].get.ts 的 FILENAME_REGEX 保持一致，
 * 避免误删目录中的非音频文件（如 .DS_Store、README 等）。
 */
const FILENAME_REGEX = /^(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webm$/i

/**
 * 扫描并清理过期音频文件
 *
 * 流程：
 *   1. 读取 AUDIO_UPLOAD_DIR 目录
 *   2. 对每个文件名用 FILENAME_REGEX 提取时间戳
 *   3. 时间戳 + TTL_MS < 当前时间 → 文件过期，删除
 *   4. 格式不匹配的文件跳过（不删除）
 *
 * 错误处理：单文件删除失败不影响其他文件，整体流程不 throw。
 */
function cleanupExpiredAudioFiles(): void {
  if (!existsSync(AUDIO_UPLOAD_DIR)) {
    return
  }

  let dirEntries: string[]
  try {
    dirEntries = readdirSync(AUDIO_UPLOAD_DIR)
  } catch (err) {
    console.error('[audio-ttl] 读取音频目录失败:', err)
    return
  }

  const now = Date.now()
  let deletedCount = 0

  for (const filename of dirEntries) {
    const match = filename.match(FILENAME_REGEX)
    if (!match) {
      // 格式不匹配的文件跳过（可能是 .DS_Store 等）
      continue
    }

    const fileTimestamp = parseInt(match[1], 10)
    if (Number.isNaN(fileTimestamp)) continue

    // 时间戳 + TTL < 当前时间 → 过期
    if (fileTimestamp + TTL_MS < now) {
      const filePath = join(AUDIO_UPLOAD_DIR, filename)
      try {
        unlinkSync(filePath)
        deletedCount++
      } catch (err) {
        // 单文件删除失败不影响其他文件
        console.error(`[audio-ttl] 删除文件失败: ${filename}`, err)
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`[audio-ttl] 清理过期音频文件: ${deletedCount} 个`)
  }
}

export default defineNitroPlugin((nitroApp) => {
  // Vercel 等 Serverless 平台不启动定时器（无文件系统写入能力）
  if (process.env.VERCEL) {
    return
  }

  // 启动时立即清理一次（清理上次服务关闭后累积的过期文件）
  cleanupExpiredAudioFiles()

  // 定时扫描清理
  const timer = setInterval(() => {
    cleanupExpiredAudioFiles()
  }, SCAN_INTERVAL_MS)

  // 进程退出时清理定时器（避免句柄泄漏阻止进程正常退出）
  // unref 让定时器不阻止进程退出（生产环境 nitro 优雅关闭时直接退出）
  timer.unref()

  // nitroApp.hooks 钩子：服务关闭时清理定时器
  nitroApp.hooks.hook('close', () => {
    clearInterval(timer)
  })

  console.log('[audio-ttl] 音频文件 TTL 清理 plugin 已加载（7 天过期，每小时扫描）')
})
