/**
 * @file 游客账号 TTL 清扫 plugin
 *
 * 每小时扫一次 users 表，回收「过期且名下无会话」的游客行（判定条件见 server/utils/guest-ttl.ts）。
 * 与 audio-ttl 同一模式：nitro 启动时先跑一次，之后定时跑，进程退出清掉定时器。
 *
 * 部署限制：Vercel 等 Serverless 平台不启动定时器。
 */
import { sweepStaleGuests } from '~/server/utils/guest-ttl'

/** 扫描间隔：每小时一次（空行累积速度下这个频率足够，也避免频繁全表扫描） */
const SCAN_INTERVAL_MS = 60 * 60 * 1000

async function runSweep(): Promise<void> {
  try {
    const deleted = await sweepStaleGuests()
    if (deleted > 0) {
      console.log(`[guest-ttl] 回收过期游客账号: ${deleted} 行`)
    }
  } catch (err) {
    // 清扫失败不影响对话主流程；下一小时还会再试
    console.error('[guest-ttl] 清理过期游客失败:', err)
  }
}

export default defineNitroPlugin((nitroApp) => {
  if (process.env.VERCEL) {
    return
  }

  void runSweep()

  const timer = setInterval(() => {
    void runSweep()
  }, SCAN_INTERVAL_MS)

  timer.unref()

  nitroApp.hooks.hook('close', () => {
    clearInterval(timer)
  })

  console.log('[guest-ttl] 游客账号 TTL 清理 plugin 已加载（7 天过期且无会话，每小时扫描）')
})
