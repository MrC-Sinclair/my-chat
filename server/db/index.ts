/**
 * @file 数据库连接初始化
 *
 * 本文件负责创建与 PostgreSQL 数据库的连接，并导出 Drizzle ORM 实例。
 *
 * 技术选型：
 *   - postgres（postgres.js）：轻量级 PostgreSQL 客户端，负责底层 SQL 通信
 *   - drizzle-orm：TypeScript ORM 框架，提供类型安全的数据库操作
 *
 * 使用方式：
 *   在其他服务端文件中导入 db 即可操作数据库：
 *     import { db } from '~/server/db'
 *     await db.select().from(sessions)
 *
 * 连接配置：
 *   通过环境变量 DATABASE_URL 获取数据库连接字符串，
 *   格式如：postgresql://user:password@localhost:5432/dbname
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/** 创建底层 PostgreSQL 连接，DATABASE_URL 来自 .env 文件 */
const sql = postgres(process.env.DATABASE_URL || '')

/**
 * 创建 Drizzle ORM 实例
 *
 * 传入 schema 对象后，Drizzle 会自动识别表之间的关联关系，
 * 支持关联查询（如通过 sessions 查询关联的 messages）。
 */
export const db = drizzle(sql, { schema })
