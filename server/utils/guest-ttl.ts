/**
 * @file 游客账号 TTL 清扫
 *
 * 为什么需要：`server/middleware/auth.ts` 对任何没有有效 Cookie 的请求都即时 insert 一行游客
 * （铸造前不区分请求路径，也没有过期回收）。线上实测一天就累积 790 行；当前 users 表 1272 行里
 * 1271 行是游客，而其中只有 1 个游客真的建过会话 —— 剩下 1270 行是扫描器/无 Cookie 探活留下的空行，
 * 且会随流量线性无限增长。
 *
 * 只回收「名下没有任何会话」的游客：会话是游客数据的唯一入口（messages / memory_vectors /
 * agent_tasks 都经 sessions 归属），没有会话就意味着这行没有任何可挽回的内容；一旦有会话就永远保留，
 * 避免把还在用的匿名身份删掉导致其历史凭空消失。
 */
import { and, eq, exists, lt, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { sessions, users } from '~/server/db/schema'

/** 游客行存活时长：与音频文件 TTL 一致，取 7 天 */
export const GUEST_TTL_DAYS = 7

/** 计算 cutoff（抽出来便于单测钉住天数，写错会把活跃匿名身份删掉） */
export function staleGuestCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - GUEST_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * 删除过期且无会话的游客行
 *
 * @returns 实际删除的行数
 */
export async function sweepStaleGuests(): Promise<number> {
  const deleted = await db
    .delete(users)
    .where(
      and(
        eq(users.isGuest, true),
        lt(users.createdAt, staleGuestCutoff()),
        sql`NOT ${exists(db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, users.id)))}`
      )
    )
    .returning({ id: users.id })

  return deleted.length
}
