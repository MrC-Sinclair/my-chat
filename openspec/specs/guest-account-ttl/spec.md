## Requirements

### Requirement: 过期空游客账号 TTL 回收

`server/middleware/auth.ts` 对任何没有有效 Cookie 的请求都会即时 INSERT 一行游客（铸造前不区分请求路径）。系统 SHALL 通过 Nitro plugin（`server/plugins/guest-ttl.ts`）每小时回收这些行，避免 `users` 表随扫描流量无限增长（线上实测单日累积 790 行，1272 行里 1271 行是游客、仅 1 个真有会话）。

回收判定 SHALL 同时满足三个条件，缺一不可：

- `is_guest = true`
- `created_at` 早于当前时间 7 天（`GUEST_TTL_DAYS`，与音频文件 TTL 一致）
- 名下**没有任何会话**（`NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.user_id = users.id)`）

#### Scenario: 过期且无会话的游客被回收

- **WHEN** 一行游客创建超过 7 天且从未建过会话
- **THEN** `sweepStaleGuests()` SHALL 删除该行并返回删除条数

#### Scenario: 有会话的游客永远保留

- **WHEN** 一行游客创建超过 7 天但名下存在会话
- **THEN** SHALL NOT 删除该行，也不 SHALL NOT 动其会话与消息
- **AND** 原因：会话是游客数据的唯一入口（messages / memory_vectors / agent_tasks 均经 sessions 归属），无会话才意味着无可挽回内容

#### Scenario: 新建游客与正式用户不受影响

- **WHEN** 游客创建未满 7 天，或该行 `is_guest = false`
- **THEN** SHALL NOT 删除

#### Scenario: 清扫失败不影响对话主流程

- **WHEN** `sweepStaleGuests()` 抛出（如 DB 不可用）
- **THEN** plugin SHALL 捕获并 `console.error`，不向上抛出
- **AND** 下一小时的扫描会再试

#### Scenario: Serverless 平台不启动定时器

- **WHEN** 运行在 Vercel（`process.env.VERCEL` 为真）
- **THEN** plugin SHALL 直接返回，不注册定时器
- **AND** 进程退出时 SHALL 清掉定时器（`nitroApp.hooks.hook('close')` + `unref()`）
