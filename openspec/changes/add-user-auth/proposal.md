# 提案：用户认证与多用户隔离（游客免登录双模式）

## Why

当前所有 API 无任何鉴权：任何能访问服务的人可以读写全部会话/消息/记忆，公网部署即裸奔。同时用户要求保留「不登录也能用」的现有体验。

## What Changes

- 新增 `users` 表 + 邮箱密码注册/登录（node:crypto scrypt 哈希，零新依赖）
- HttpOnly 签名 Cookie 承载身份；**游客免登录**：首次访问自动创建 `is_guest=true` 的游客用户并绑定 Cookie，数据照常落库、按游客隔离
- 游客注册 = 就地升级当前游客行（数据无感保留）；登录已有账号 = 切换身份（游客数据留在游客行）
- `sessions` 表加 `user_id` 外键（级联删除），全部数据 API 加归属校验；存量会话归入迁移创建的 legacy 游客用户
- 前端侧边栏底部展示当前身份，游客可发起注册/登录

## Impact

| 层级 | 变更 |
| --- | --- |
| 数据库 | 新增 `users` 表；`sessions` 加 `user_id` 外键 + 索引；`pnpm db:push` |
| 服务端 | 新增 `server/api/auth/*`（register/login/logout/me）；`server/utils/auth.ts`（Cookie 签名/密码哈希/取当前用户）；全部数据 API 加归属校验 |
| 前端 | `useAuth` composable + 登录/注册对话框 + 侧边栏身份区改造 |
| 文档 | `docs/db-schema.md`、`docs/API.md`、`.env.example`（AUTH_SECRET） |

## Capabilities

- New Capabilities: user-auth（注册/登录/游客/会话 Cookie）
- Modified Capabilities: session-management（数据按用户隔离）、messages-api（归属校验）

## 关键决策预告（详见 design.md）

1. 密码哈希用 node:crypto scrypt 而非 bcrypt：零新依赖，安全强度足够
2. Cookie 用 HMAC 签名（`userId.timestamp.signature`）而非 JWT：无依赖、可服务端失效（换密钥全失效）
3. 游客 = `users` 行（`is_guest=true`）：数据隔离对游客同样生效，「不登录也能用」且注册后数据无感升级
