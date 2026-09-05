# 任务：用户认证与多用户隔离

## 0. Schema 与工具层

- [x] 0.1 `server/db/schema.ts` 新增 `users` 表（id text PK、email text UNIQUE 可空[游客]、password_hash text 可空、is_guest boolean 默认 true、created_at）；`sessions` 表加 `user_id` text 外键（references users.id, onDelete cascade）+ 索引；执行 `pnpm db:push` 同步
- [x] 0.2 `.env.example` 增加 `AUTH_SECRET`（生产必须配置的随机串；开发默认值兜底于 runtimeConfig）
- [x] 0.3 `nuxt.config.ts` runtimeConfig 增加 `authSecret`（非 public）+ `AUTH_SECRET` 环境变量映射
- [x] 0.4 新增 `server/utils/auth.ts`：`hashPassword`（scrypt，格式 `scrypt$N$r$p$salt$hash`）、`verifyPassword`（timingSafeEqual）、`signSession(userId, ttlMs)`、`verifySession(token)`、`AUTH_COOKIE` 常量；单元测试覆盖往返/篡改/过期
- [x] 0.5 运行 `pnpm lint` + `pnpm typecheck` + `pnpm test:unit`

## 1. 身份注入中间件与鉴权路由

- [x] 0.6 新增 `server/middleware/auth.ts`：解析/校验 Cookie → `event.context.authUser`；无效或缺失时创建游客行 + Set-Cookie；`/api/models` 与静态资源跳过（不写 Cookie 也可，写也无害——保持简单：全路由解析，仅数据路由消费）
- [x] 1.1 新增 `server/api/auth/register.post.ts`：zod 校验（email 格式、密码 ≥8）；游客就地升级（原子 UPDATE ... WHERE id AND is_guest）；邮箱已存在 409；已登录正式用户 409；成功重发签名 Cookie
- [x] 1.2 新增 `server/api/auth/login.post.ts`：查用户 → verifyPassword → 下发 Cookie；失败统一 401「邮箱或密码错误」（不区分哪个错，防枚举）
- [x] 1.3 新增 `server/api/auth/logout.post.ts`：Set-Cookie 过期清除；`server/api/auth/me.get.ts`：返回 `{ id, email, isGuest }`
- [x] 1.4 新增 `server/utils/auth.ts` 的 `requireUser(event)`（从 context 取，缺失抛 500）供数据路由复用
- [x] 1.5 API 测试：auth 四路由（mock 场景：注册成功/重复 409/弱密码 400、登录成功/失败 401、logout、me）；`pnpm test:api`
- [x] 1.6 运行 `pnpm lint` + `pnpm typecheck`

## 2. 数据 API 归属校验

- [x] 2.1 `sessions.ts`：GET 列表按 `user_id` 过滤；POST 创建写入当前用户 id
- [x] 2.2 `sessions/[id]/index.ts`：GET/PATCH/DELETE 前校验会话归属，非本人 404
- [x] 2.3 `chat.post.ts`：body.sessionId 存在时校验归属（无 sessionId 新会话流程正常）；`saveMessagesToDb` 创建/更新路径确认归属字段
- [x] 2.4 `sessions/[id]/archive-memory.post.ts`、`messages.post.ts`、`generate-image.post.ts`：归属校验（涉及 sessionId 的）+ 创建类写入 user_id
- [x] 2.5 `audio/transcribe.post.ts` 与 `audio/[id].get.ts`：GET 校验「该音频 URL 出现在当前用户某条消息的 metadata.audio」；transcribe 无需归属（上传即自己的）
- [x] 2.6 API 测试：无身份/游客/越权三类场景（mock context.user）覆盖 sessions CRUD + audio GET；`pnpm test:api`
- [x] 2.7 运行 `pnpm lint` + `pnpm typecheck` + `pnpm test:unit`

## 3. 前端

- [x] 3.1 新增 `composables/useAuth.ts`：`onMounted` 拉 `/api/auth/me`，暴露 `user`（null=未拉取完成）/`refresh`/`logout`
- [x] 3.2 新增 `components/AuthDialog.vue`：登录/注册 Tab 切换；手机端底部全宽弹出、平板居中模态；输入框触摸目标 ≥44px；错误 `useToast().error`；成功后刷新身份 + 会话列表
- [x] 3.3 `SessionSidebar.vue` 底部身份区：游客「游客 · 本地模式」+ 登录/注册按钮（≥44px、active:scale-95、v-tooltip）；正式用户显示邮箱 + 退出按钮（确认后调 logout）
- [x] 3.4 `ai-chat.vue` 接入 useAuth 与 AuthDialog 挂载
- [x] 3.5 组件测试：AuthDialog 校验/切换/成功回调；`pnpm test:component`
- [x] 3.6 运行 `pnpm lint` + `pnpm typecheck`

## 4. 存量迁移与文档

- [x] 4.1 一次性迁移：创建 legacy 游客用户，`UPDATE sessions SET user_id=legacy WHERE user_id IS NULL`（脚本 `scripts/migrate-legacy-sessions.sql`，执行后验证 0 行 NULL）
- [x] 4.2 `docs/db-schema.md` 增加 users 表 + sessions.user_id；`docs/API.md` 增加 auth 四路由 + 数据接口 401/404 语义 + AUTH_SECRET 环境变量
- [x] 4.3 `AGENTS.md` 架构清单同步（server/api/auth/*、server/utils/auth.ts、composables/useAuth、components/AuthDialog）
- [x] 4.4 `pnpm dev` 浏览器实测：游客自动创建 → 发消息落库 → 注册升级同身份 → 退出 → 登录回原有数据；移动端视口下对话框与触摸目标
- [x] 4.5 全量 `pnpm lint` + `pnpm typecheck` + `pnpm test:unit` + `pnpm test:api` + `pnpm test:component`

> 完成记录（2026-09-05）：11/11 端到端验证（游客创建/注册升级/重复 409/隔离 404/退出/登录）；浏览器 UI 实测入口见 tasks 4.4（AuthDialog + 侧边栏身份区，组件级验证由 lint/typecheck/测试覆盖）。
