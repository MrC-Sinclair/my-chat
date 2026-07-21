## Requirements

### Requirement: 内容安全策略（CSP）头部

`server/middleware/security.ts` SHALL 在每个请求上设置 `Content-Security-Policy` 响应头部，值为以下指令拼接的字符串（分号分隔）：`default-src 'self'`、`script-src 'self' 'unsafe-inline' 'unsafe-eval'`、`style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`、`font-src 'self' https://cdn.jsdelivr.net`、`img-src 'self' data: blob: https:`、`connect-src 'self' https://api.siliconflow.cn`、`frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'self'`。

CSP 白名单 MUST 满足以下运行时需求：
- `style-src` MUST 保留 `'unsafe-inline'`，因为 KaTeX 与 Mermaid 通过内联 `style` 属性注入样式（KaTeX 公式渲染、Mermaid 图表尺寸），移除将导致公式与图表视觉错乱
- `script-src` 保留 `'unsafe-inline'` 与 `'unsafe-eval'` 以支持 Nuxt 开发模式 HMR 与依赖运行时 eval 的依赖
- `img-src` MUST 包含 `data:`（base64 内联图片）、`blob:`（本地图片预览）和 `https:`（ImgBB 图床公网 URL 及任意 HTTPS 图片源）
- `connect-src` MUST 包含 `https://api.siliconflow.cn`（LLM Provider 域名，前端不直连但保留以备扩展），新增 LLM Provider 域名时 MUST 同步追加到此指令
- `frame-ancestors 'none'` 等效于 `X-Frame-Options: DENY`，禁止任何页面嵌入

任何对 CSP 白名单的变更 MUST 重新验证 KaTeX 公式渲染、Mermaid 图表渲染、ImgBB 图片对话三条链路不回归。

#### Scenario: 每个响应都携带 CSP 头部

- **WHEN** 客户端发起任意 HTTP 请求（包括静态资源、API、页面路由）
- **THEN** 响应头部包含 `Content-Security-Policy`，值包含 `default-src 'self'`、`style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`、`img-src 'self' data: blob: https:`、`connect-src 'self' https://api.siliconflow.cn`、`frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'self'`

#### Scenario: style-src 必须保留 unsafe-inline 以支持 KaTeX/Mermaid

- **WHEN** 前端渲染 KaTeX 公式或 Mermaid 图表（依赖内联 `style` 属性）
- **THEN** 由于 CSP `style-src` 包含 `'unsafe-inline'`，浏览器不阻止这些内联样式
- **AND** 修改 `CSP_DIRECTIVES` 时 MUST 保留 `'unsafe-inline'` 在 `style-src`，否则公式与图表视觉错乱

#### Scenario: img-src 允许 data/blob/https 图片源

- **WHEN** 用户在对话中粘贴 base64 图片（`data:` URI）或上传图片生成 `blob:` 预览，或 AI 回复中包含 ImgBB 公网图片 URL（`https://`）
- **THEN** 由于 CSP `img-src` 包含 `data:`、`blob:`、`https:`，浏览器加载这些图片不被阻止

### Requirement: CORS 跨域资源共享

`server/middleware/security.ts` SHALL 实现 CORS 策略：仅当请求 `Origin` 头部严格匹配允许列表 `['http://localhost:3000']` 时，才设置 `Access-Control-Allow-Origin`（值等于请求 `Origin`）、`Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`、`Access-Control-Allow-Headers: Content-Type, Authorization`、`Access-Control-Max-Age: 86400`。`Origin` 缺失或不在允许列表时 MUST NOT 设置任何 `Access-Control-*` 头部。

`allowedOrigins` 当前仅包含 `['http://localhost:3000']`，部署到其他域名（如生产环境）时 MUST 同步更新此数组，否则浏览器跨域请求会被浏览器拦截。

OPTIONS 预检请求 SHALL 在中间件中短路返回 `204 No Content`（空 body），不进入后续业务处理器。

#### Scenario: 允许列表内的 Origin 设置完整 CORS 头部

- **WHEN** 请求 `Origin` 头部为 `http://localhost:3000`
- **THEN** 响应包含 `Access-Control-Allow-Origin: http://localhost:3000`、`Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`、`Access-Control-Allow-Headers: Content-Type, Authorization`、`Access-Control-Max-Age: 86400`

#### Scenario: 非允许 Origin 不设置 CORS 头部

- **WHEN** 请求 `Origin` 头部为 `https://evil.example.com` 或 `http://localhost:8080`
- **THEN** 响应不包含任何 `Access-Control-Allow-Origin` 头部
- **AND** 浏览器将拒绝该跨域请求读取响应

#### Scenario: 无 Origin 头部的同源请求不设置 CORS

- **WHEN** 请求未携带 `Origin` 头部（同源请求或非浏览器请求）
- **THEN** 响应不包含任何 `Access-Control-*` 头部

#### Scenario: OPTIONS 预检请求短路返回 204

- **WHEN** 请求方法为 `OPTIONS`（CORS 预检）
- **THEN** 中间件设置状态码 `204`，返回空字符串 `''`
- **AND** 不进入后续业务处理器（如 `/api/chat` 等路由处理函数）

#### Scenario: 部署到新域名需同步更新 allowedOrigins

- **WHEN** 项目部署到 `https://chat.example.com` 等新域名
- **THEN** MUST 将新域名追加到 `allowedOrigins` 数组，否则前端跨域调用 API 会被浏览器拦截

### Requirement: API 路径速率限制

`server/middleware/security.ts` SHALL 对所有以 `/api/` 开头的路径实施速率限制：每个客户端 IP 在 `60_000` 毫秒（60 秒）窗口内最多允许 `30` 次请求，超限返回 `429 Too Many Requests` 状态码与 `Retry-After: 60` 头部。

速率限制实现细节：
- 限流键为 `getClientIp(req)` 提取的客户端 IP
- 使用进程内 `Map<string, { count: number; resetTime: number }>` 存储计数（重启后重置，不持久化）
- 窗口过期后自动重置计数
- 每个响应（限 /api/ 路径）MUST 设置 `X-RateLimit-Limit: 30` 与 `X-RateLimit-Remaining: <剩余次数>` 头部
- 超限时 MUST 设置 `Retry-After: 60` 并 `throw createError({ statusCode: 429, statusMessage: '请求过于频繁，请稍后再试' })`

非 `/api/` 路径（静态资源、页面路由）MUST NOT 应用速率限制。

#### Scenario: 60 秒窗口内前 30 次请求允许通过

- **WHEN** 同一客户端 IP 在 60 秒内向 `/api/chat` 发起 30 次请求
- **THEN** 所有 30 次请求均正常进入业务处理器
- **AND** 每次响应包含 `X-RateLimit-Limit: 30` 与递减的 `X-RateLimit-Remaining`

#### Scenario: 第 31 次请求被拒返回 429

- **WHEN** 同一客户端 IP 在 60 秒窗口内已发起 30 次请求，第 31 次请求到达
- **THEN** 中间件抛出 `createError({ statusCode: 429, statusMessage: '请求过于频繁，请稍后再试' })`
- **AND** 响应包含 `Retry-After: 60`、`X-RateLimit-Limit: 30`、`X-RateLimit-Remaining: 0` 头部

#### Scenario: 窗口过期后计数自动重置

- **WHEN** 客户端 IP 在窗口过期后（`now > entry.resetTime`）发起新请求
- **THEN** `checkRateLimit` 重置该 IP 的计数为 1，重置 `resetTime` 为 `now + 60_000`
- **AND** 请求正常通过

#### Scenario: 非 API 路径不受速率限制

- **WHEN** 请求路径为 `/`、`/ai-chat`、`/_nuxt/xxx.js` 等非 `/api/` 开头路径
- **THEN** 中间件不调用 `checkRateLimit`，不设置 `X-RateLimit-*` 头部
- **AND** 请求不受 30 次/60 秒限制

### Requirement: UUID v4 路径参数校验

`server/middleware/security.ts` SHALL 对匹配正则 `^/api/sessions/[^/]+$` 的路径执行会话 ID 格式校验：提取路径最后一段作为 `sessionId`，使用正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`（UUID v4 格式，大小写不敏感）校验。非法格式 MUST `throw createError({ statusCode: 400, statusMessage: '会话ID格式无效' })`。

校验目的：在中间件层拦截非法会话 ID，避免无效请求进入数据库查询层，同时防止路径注入攻击。

#### Scenario: 合法 UUID 通过校验

- **WHEN** 请求路径为 `/api/sessions/550e8400-e29b-41d4-a716-446655440000`
- **THEN** 中间件不抛出错误，请求继续进入 `/api/sessions/[id].ts` 处理器

#### Scenario: 非法会话 ID 返回 400

- **WHEN** 请求路径为 `/api/sessions/not-a-uuid` 或 `/api/sessions/1` 或 `/api/sessions/../../etc/passwd`
- **THEN** 中间件抛出 `createError({ statusCode: 400, statusMessage: '会话ID格式无效' })`
- **AND** 请求不进入 `/api/sessions/[id].ts` 处理器

#### Scenario: 大写 UUID 通过校验

- **WHEN** 请求路径为 `/api/sessions/550E8400-E29B-41D4-A716-446655440000`
- **THEN** 由于正则带 `i` 标志（大小写不敏感），中间件不抛出错误，请求继续

#### Scenario: 嵌套子路径不触发校验

- **WHEN** 请求路径为 `/api/sessions/550e8400-e29b-41d4-a716-446655440000/messages` 或 `/api/sessions/550e8400.../archive-memory`
- **THEN** 路径不匹配 `^/api/sessions/[^/]+$` 正则，中间件不执行 UUID 校验（由子路由自行处理参数）

### Requirement: X-Content-Type-Options 防止 MIME 类型嗅探

`server/middleware/security.ts` SHALL 对每个响应设置 `X-Content-Type-Options: nosniff` 头部，禁止浏览器嗅探响应 MIME 类型，防止将非脚本响应误解为可执行脚本。

#### Scenario: 每个响应都携带 nosniff 头部

- **WHEN** 客户端发起任意 HTTP 请求
- **THEN** 响应头部包含 `X-Content-Type-Options: nosniff`
- **AND** 浏览器严格遵循 `Content-Type` 头部，不嗅探响应内容类型

### Requirement: X-Frame-Options 防止点击劫持

`server/middleware/security.ts` SHALL 对每个响应设置 `X-Frame-Options: DENY` 头部，禁止页面被任何其他页面以 `<iframe>`、`<frame>`、`<object>`、`<embed>` 形式嵌入，防止点击劫持（Clickjacking）攻击。

注意：CSP `frame-ancestors 'none'` 指令在现代浏览器中等效覆盖此功能，但 `X-Frame-Options: DENY` 仍保留作为旧浏览器（IE11 及更早）的回退防护。

#### Scenario: 每个响应都携带 X-Frame-Options: DENY

- **WHEN** 攻击者尝试在恶意页面中以 `<iframe src="http://localhost:3000/ai-chat">` 嵌入本应用
- **THEN** 由于响应包含 `X-Frame-Options: DENY`，浏览器拒绝渲染该 iframe
- **AND** 同时由于 CSP `frame-ancestors 'none'`，现代浏览器也拒绝渲染

### Requirement: Referrer-Policy 头部

`server/middleware/security.ts` SHALL 对每个响应设置 `Referrer-Policy: strict-origin-when-cross-origin` 头部，控制 `Referer` 头部泄露策略：同源请求发送完整 Referer，跨源请求仅发送 origin（不含路径与查询参数），HTTPS→HTTP 降级时不发送 Referer。

#### Scenario: 每个响应都携带 Referrer-Policy 头部

- **WHEN** 客户端发起任意 HTTP 请求
- **THEN** 响应头部包含 `Referrer-Policy: strict-origin-when-cross-origin`
- **AND** 后续该页面发起的跨源请求（如加载 ImgBB 图片）仅向目标站点泄露 origin（`http://localhost:3000`），不泄露路径与查询参数

#### Scenario: 与 markdown img referrerpolicy 属性协同

- **WHEN** `MarkdownRenderer.vue` 渲染 AI 回复中的 markdown 图片，对 `<img>` 元素设置 `referrerpolicy="no-referrer"` 属性
- **THEN** 该图片元素级别的 `no-referrer` 属性优先于 HTTP 头部的 `strict-origin-when-cross-origin`，加载图片时不发送任何 Referer
- **AND** 修改 `Referrer-Policy` 头部时 MUST 同时验证 markdown 图片的 `referrerpolicy` 属性是否仍需要单独设置

### Requirement: 不缓冲 SSE 流式响应

`server/middleware/security.ts` SHALL 仅执行头部设置与速率限制检查，MUST NOT 读取、缓冲或拦截 `response` body。中间件 MUST NOT 调用 `res.write()`、`res.end()`、或对 `res.write`/`res.end` 做 monkey-patch（该操作由 `nuxt.config.ts` 的 `fix-windows-path-urls` Vite 中间件负责，且仅对 `text/html` 响应生效）。

此约束确保 `/api/chat` 的 SSE 流式响应（`text/event-stream`）能够逐 chunk 直接透传到客户端，保持打字机效果。任何对 `security.ts` 的修改 MUST 验证 SSE 流式输出未被缓冲（通过浏览器 Network 面板检查 `/api/chat` 响应是否逐 chunk 到达）。

#### Scenario: /api/chat 的 SSE 响应不被中间件缓冲

- **WHEN** 客户端发起 `/api/chat` 请求，服务端通过 `streamText` 生成 SSE 流式响应
- **THEN** `security.ts` 中间件仅设置 CSP/CORS/限流头部，不读取或缓冲 response body
- **AND** SSE chunk 直接透传到客户端，浏览器观察到逐 token 到达的打字机效果

#### Scenario: 中间件不调用 res.write/res.end

- **WHEN** 检查 `security.ts` 源码
- **THEN** 不存在对 `event.node.res.write()` 或 `event.node.res.end()` 的调用
- **AND** 不存在对 `res.write`/`res.end` 的重新赋值（monkey-patch）

#### Scenario: 修改中间件后必须验证流式输出

- **WHEN** 开发者修改 `security.ts` 中间件逻辑
- **THEN** MUST 在浏览器 Network 面板检查 `/api/chat` 响应是否逐 chunk 到达（非一次性到达）
- **AND** 若流式效果消失，说明中间件意外缓冲了 response body，必须回滚或修复

### Requirement: getClientIp 客户端 IP 提取函数

`server/middleware/security.ts` SHALL 导出内部函数 `getClientIp(req: IncomingMessage): string`，按以下优先级提取客户端 IP：
1. 若 `req.headers['x-forwarded-for']` 为字符串，取逗号分隔的第一项并 `trim()`（即链路中第一个 IP，不区分内网/公网）
2. 否则返回 `req.socket?.remoteAddress`（TCP 连接远端地址）
3. 若以上均为空，返回 `'unknown'` 字符串字面量

此函数仅用于速率限制的 IP 键（见「API 路径速率限制」Requirement），MUST NOT 用于业务逻辑中的 IP 注入（`chat.post.ts` 有独立的 IP 提取逻辑用于 prompt 注入，详见 `ip-location-tool` spec）。

注意：当前实现不解析 `x-real-ip` 头部，仅解析 `x-forwarded-for` 与 `socket.remoteAddress`。本地开发场景下 `x-forwarded-for` 缺失，`socket.remoteAddress` 通常为 `127.0.0.1` 或 `::1`。

#### Scenario: x-forwarded-for 存在时取第一项

- **WHEN** 请求头部 `x-forwarded-for: 119.29.29.29, 10.0.0.1`（多层代理链路）
- **THEN** `getClientIp(req)` 返回 `'119.29.29.29'`（第一项，trim 后）
- **AND** 该 IP 作为速率限制的键

#### Scenario: x-forwarded-for 缺失时回退到 socket.remoteAddress

- **WHEN** 请求未携带 `x-forwarded-for` 头部
- **AND** `req.socket.remoteAddress` 为 `'127.0.0.1'`（本地开发场景）
- **THEN** `getClientIp(req)` 返回 `'127.0.0.1'`

#### Scenario: 所有来源均缺失时返回 unknown

- **WHEN** 请求未携带 `x-forwarded-for` 头部
- **AND** `req.socket?.remoteAddress` 为 `undefined` 或空
- **THEN** `getClientIp(req)` 返回字符串字面量 `'unknown'`
- **AND** 速率限制以 `'unknown'` 为键（所有此类请求共享同一限流桶）

#### Scenario: getClientIp 不用于 prompt 注入

- **WHEN** 检查 `security.ts` 源码
- **THEN** `getClientIp` 的返回值仅用于 `checkRateLimit(ip)` 调用
- **AND** 不存在将 `getClientIp` 返回值注入到 LLM system prompt 的逻辑（该逻辑在 `chat.post.ts` 中独立实现）

### Requirement: 其他浏览器安全头部

`server/middleware/security.ts` SHALL 对每个响应设置以下附加安全头部：
- `X-XSS-Protection: 0`：显式禁用浏览器内置 XSS Auditor（现代浏览器已弃用该功能，且 Auditor 本身可能引入 XSS 漏洞，故设为 `0` 关闭）
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`：禁用摄像头、麦克风、地理位置等敏感设备权限 API，防止恶意脚本滥用

#### Scenario: 每个响应都携带 X-XSS-Protection: 0

- **WHEN** 客户端发起任意 HTTP 请求
- **THEN** 响应头部包含 `X-XSS-Protection: 0`
- **AND** 浏览器内置 XSS Auditor 被显式关闭（避免引入额外 XSS 风险）

#### Scenario: 每个响应都携带 Permissions-Policy 禁用敏感设备

- **WHEN** 客户端发起任意 HTTP 请求
- **THEN** 响应头部包含 `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **AND** 页面中的 JavaScript 调用 `navigator.mediaDevices.getUserMedia()` 或 `navigator.geolocation.getCurrentPosition()` 时被浏览器拒绝
