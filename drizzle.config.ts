/**
 * @file Drizzle Kit 配置
 *
 * 本文件配置 Drizzle Kit — Drizzle ORM 的命令行工具，用于：
 *   - 生成数据库迁移文件（drizzle-kit generate）
 *   - 推送 Schema 变更到数据库（drizzle-kit push）
 *   - 查看数据库当前状态（drizzle-kit studio）
 *
 * 使用方式：
 *   pnpm drizzle-kit generate   → 根据 schema.ts 生成 SQL 迁移文件
 *   pnpm drizzle-kit push       → 直接将 schema 变更同步到数据库（开发环境推荐）
 *   pnpm drizzle-kit studio     → 打开数据库可视化管理界面
 */

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  /** Schema 文件路径，Drizzle Kit 会读取此文件来了解数据库结构 */
  schema: './server/db/schema.ts',
  /** 迁移文件输出目录，generate 命令会将 SQL 文件写入此目录 */
  out: './drizzle',
  /** 数据库方言，本项目使用 PostgreSQL */
  dialect: 'postgresql',
  /** 数据库连接凭据，DATABASE_URL 来自 .env 文件 */
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
})
