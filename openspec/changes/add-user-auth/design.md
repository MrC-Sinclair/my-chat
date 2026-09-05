# 设计：用户认证与多用户隔离

## Goals

- 公网部署时数据按用户严格隔离；不登录仍可完整使用（游客身份）
- 零新增 npm 依赖（crypto + cookie 原生能力）
- 存量数据平滑迁移（归入 legacy 游客，不丢数据）

## Non-Goals

- 邮箱验证/找回密码（后续迭代）
- OAuth 第三方登录
- 游客数据跨浏览器漫游（游客绑定单浏览器 Cookie）

## 关键决策

### 决策 1：密码哈希用 scrypt（node:crypto）

scrypt 为 Node 内置（`crypto.scrypt`），抗 GPU 暴力破解强度与 bcrypt 同级，零依赖。存储格式：`scrypt$N$r$p$salt$hash`，参数固化（N=16384, r=8, p=1），校验用 `timingSafeEqual` 防时序攻击。

### 决策 2：会话 Cookie 用 HMAC 签名而非 JWT

格式：`<userId>.<expiresAtMs>.<hmacSHA256(userId.expiresAt, secret)>`。理由：无需 JWT 库；签名校验失败/过期即拒；更换 AUTH_SECRET 可令所有会话失效（服务端可控）。Cookie 属性：HttpOnly + SameSite=Lax + Path=/ + 30 天过期（安全：不设 domain，仅同源）。

### 决策 3：游客即 users 行（is_guest=true）

- 首次请求无有效 Cookie → 创建 `is_guest=true` 行 → 下发 Cookie → 后续请求与正式用户同路径隔离
- **注册（游客态）= 就地升级**：`UPDATE users SET email, password_hash, is_guest=false WHERE id=当前游客id`，数据无感保留
- **登录已有账号**：直接切换 Cookie 到目标用户；游客数据留在原游客行（不做合并，避免跨账号数据冲突；游客行为浏览器本地，可接受）

### 决策 4：隔离通过 sessions.user_id 单点外键实现

messages/feedbacks/memory_vectors 均经 session_id 级联归属，无需各自加 user_id。API 归属校验统一走「session 是否属于当前用户」单条查询。

### 决策 5：身份注入用 server middleware

`server/middleware/auth.ts`（全局）：解析 Cookie → `event.context.authUser = { id, isGuest } | null` → 无 Cookie 时自动创建游客并 Set-Cookie。数据路由统一从 `requireUser(event)` 取身份，杜绝各路由重复解析。

- 静态资源与 `/api/models`、`/api/auth/*`、`/api/audio/*`（见决策 6）不走强制身份

### 决策 6：音频文件归属校验

文件名不携带归属信息，通过 DB 反查：请求的 `/api/audio/:id` 必须存在一条当前用户会话内的消息，其 `metadata.audio.url` 匹配该文件，否则 404。上传（transcribe）路由天然属于发起请求的登录态/游客。

### 决策 7：存量数据迁移

`db:push` 后执行一次性 SQL（tasks 4.x）：创建 legacy 游客用户（固定 UUID）并将全部 `user_id IS NULL` 的会话归入。迁移脚本放 `scripts/migrate-legacy-sessions.sql`（一次性，gitignore 可查档）。

## API 设计

| 路由 | 方法 | 说明 | 校验/错误 |
| --- | --- | --- | --- |
| `/api/auth/register` | POST | `{ email, password }`；游客态就地升级，已登录正式用户 409 | zod：email 格式、密码 ≥ 8 位；409 邮箱已存在；400 参数缺失 |
| `/api/auth/login` | POST | `{ email, password }` | 401 邮箱或密码错误；429 走全局限流 |
| `/api/auth/logout` | POST | 清除 Cookie | 200 恒定 |
| `/api/auth/me` | GET | 当前身份 `{ id, email, isGuest }` | 200（未登录返回游客身份） |

数据路由（sessions/messages/generate-image/audio/transcribe/chat/archive-memory）统一：无身份 → 自动游客（决策 5），涉及具体资源 → 归属校验失败 404（不泄露存在性）。

## UI 适配（手机默认 / 平板 sm:）

- 侧边栏底部身份区（现有「My Chat 用户 / 本地模式」位置）：游客显示「游客 · 本地模式」+「登录 / 注册」入口；正式用户显示邮箱 +「退出」
- 登录/注册用同一对话框组件（Tab 切换），手机端全宽底部弹出、平板居中模态；触摸目标 ≥ 44px；`active:scale-95` 反馈；错误 toast 走 `useToast()`

## SSR 水合安全

- 身份只在 `onMounted` 的 `/api/auth/me` 拉取（Cookie 是 HttpOnly，SSR 与客户端首帧渲染相同：默认游客占位），不产生水合不匹配
- 登录/注册成功后仅客户端更新状态 + `refreshNuxtData`/手动刷新会话列表，不做服务端重定向
