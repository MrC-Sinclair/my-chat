## ADDED Requirements

### Requirement: weather.ts 导出 getCityByIp 核心函数

`server/tools/weather.ts` SHALL 导出 `getCityByIp(ip: string)` 异步函数，接受 IPv4 或 IPv6 字符串，返回包含城市信息的结构化对象 `{ city, region, country, lat, lon, isLocal, error }`。函数 MUST 在入口执行严格 IP 格式校验和内网/保留地址黑名单拦截（不发起外部 HTTP 请求），使用 `encodeURIComponent` 编码 IP 参数构造 URL，设置 fetch 超时（10 秒）。失败时返回错误对象（`city: null, error: string`）而非抛出异常。本工具不做 DNS 双重校验（固定连接 ip-api.com，IP 仅作 URL 路径参数，无 DNS rebinding 攻击面）。

内网/保留地址黑名单 MUST 覆盖以下网段：
- IPv4: `127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`（含云元数据 `169.254.169.254`）、`0.0.0.0`
- IPv6: `::1`、`fe80::/10`（link-local）、`fc00::/7`（ULA，含 `fd00::/8`）

#### Scenario: 查询公网 IP 城市成功（中文返回）

- **WHEN** 调用 `getCityByIp("119.29.29.29")`（腾讯 DNS，定位广东深圳）
- **AND** ip-api.com 返回 `{ status: "success", city: "深圳", regionName: "广东", country: "中国", lat: 22.54, lon: 114.06 }`
- **THEN** 函数返回 `{ city: "深圳", region: "广东", country: "中国", lat: 22.54, lon: 114.06, isLocal: false, error: null }`

#### Scenario: 查询英文 IP 城市返回中文城市名

- **WHEN** 调用 `getCityByIp("8.8.8.8")`（Google DNS，美国加利福尼亚）
- **AND** ip-api.com 返回 `{ status: "success", city: "Mountain View", regionName: "California", country: "美国", lat: 37.386, lon: -122.0838 }`（因 `lang=zh` 参数 country 字段为中文）
- **THEN** 函数返回 `{ city: "Mountain View", region: "California", country: "美国", lat: 37.386, lon: -122.0838, isLocal: false, error: null }`

#### Scenario: 本地/内网 IP 短路返回 isLocal 标记（不发起 HTTP 请求）

- **WHEN** 调用 `getCityByIp("127.0.0.1")` 或 `getCityByIp("::1")` 或 `getCityByIp("192.168.1.1")` 或 `getCityByIp("10.0.0.1")`
- **THEN** 函数不发起外部 HTTP 请求（直接在黑名单校验阶段短路）
- **AND** 返回 `{ city: null, region: null, country: null, lat: null, lon: null, isLocal: true, error: "本地/内网 IP，无法定位" }`

#### Scenario: 云元数据 IP 169.254.169.254 被拦截

- **WHEN** 调用 `getCityByIp("169.254.169.254")`
- **THEN** 函数不发起外部 HTTP 请求
- **AND** 返回 `{ city: null, isLocal: true, error: "本地/内网 IP，无法定位", ... }`

#### Scenario: 非法 IP 格式

- **WHEN** 调用 `getCityByIp("not-an-ip")` 或 `getCityByIp("999.999.999.999")` 或 `getCityByIp("1.2.3")` 或 `getCityByIp("abc:::1")`
- **THEN** 函数返回 `{ city: null, isLocal: false, error: "IP 格式不合法", ... }`

#### Scenario: IP 包含特殊字符被 URL 编码拦截

- **WHEN** 调用 `getCityByIp("127.0.0.1%0d%0a")` 或含 `@`、`/` 等特殊字符的伪造字符串
- **THEN** 格式校验失败，函数返回错误对象，不发起 HTTP 请求

#### Scenario: ip-api.com 网络失败或超时

- **WHEN** ip-api.com 返回非 200 状态码、fetch 抛出异常、或请求超过 10 秒超时
- **THEN** 函数返回 `{ city: null, isLocal: false, error: "IP 定位服务暂时不可用: <错误描述>", ... }`，不抛出异常

#### Scenario: ip-api.com 返回 status: fail

- **WHEN** ip-api.com 返回 `{ status: "fail", message: "private range" }` 或其他失败消息
- **THEN** 函数返回 `{ city: null, isLocal: false, error: "IP 定位失败: <message>", ... }`

### Requirement: MCP Weather Server 注册 getCityByIp 工具

`server/mcp/weather-server.ts` SHALL 通过 `server.registerTool('getCityByIp', ...)` 注册新 MCP 工具，入参 schema 为 `{ ip: z.string().describe(...) }`，复用 weather.ts 的 `getCityByIp` 核心函数。工具 description MUST 明确说明「何时调用」（用户未提供城市但询问本地信息/天气时）和「何时不调用」（用户已显式提供城市名时）。MCP handler MUST NOT 重复执行 IP 校验（校验在核心函数内完成），仅负责将返回值序列化为 MCP 响应格式。

#### Scenario: LLM 通过 MCP 调用 getCityByIp 成功

- **WHEN** MCP 客户端调用 `getCityByIp` 工具，传入 `{ ip: "119.29.29.29" }`
- **THEN** Server 返回 `{ content: [{ type: "text", text: "<JSON 序列化的城市信息>" }] }`，无 `isError` 标记

#### Scenario: LLM 传入本地/内网 IP

- **WHEN** MCP 客户端调用 `getCityByIp` 工具，传入 `{ ip: "127.0.0.1" }`
- **THEN** Server 返回 `{ content: [{ type: "text", text: "{\"city\":null,\"isLocal\":true,\"error\":\"本地/内网 IP，无法定位\",...}" }], isError: true }`

#### Scenario: LLM 传入非法 IP

- **WHEN** MCP 客户端调用 `getCityByIp` 工具，传入 `{ ip: "invalid" }`
- **THEN** Server 返回 `{ content: [{ type: "text", text: "{\"city\":null,\"isLocal\":false,\"error\":\"IP 格式不合法\",...}" }], isError: true }`

#### Scenario: getCityByIp 核心函数抛出未预期异常

- **WHEN** 核心函数抛出未预期异常（如未覆盖的边界情况）
- **THEN** Server 包装层 try-catch 捕获异常，返回 `{ content: [{ type: "text", text: "IP 定位失败: <错误消息>" }], isError: true }`，不向 MCP 客户端泄露堆栈

### Requirement: chat.post.ts 注入客户端 IP 到 system prompt

`server/api/chat.post.ts` SHALL 在 `streamText` 调用前读取客户端请求 IP，按优先级：1) `x-forwarded-for` 第一个非内网 IP（逗号分隔链路，内网判断使用内联辅助函数实现，不 import weather.ts）；2) `x-real-ip`；3) `event.node.req.socket.remoteAddress`。若所有来源为空或均为内网 IP，则跳过注入。获取到有效公网 IP 后，将其追加到 `finalSystemPrompt` 末尾。chat.post.ts MUST NOT 直接 import 或调用 weather.ts 的任何业务函数。注意：当前"取第一个非内网 IP"策略适配 Vercel/Cloudflare 等覆盖式代理；部署到自建 Nginx（appending 模式）时攻击者可伪造 `X-Forwarded-For` 头部，影响仅限于天气查询结果不准确，非安全风险。

Prompt 注入格式 MUST 为：
```
【用户位置上下文】用户当前请求 IP: {ip}，如需定位用户所在城市请调用 getCityByIp 工具传入该 IP。
```

#### Scenario: 生产环境正常读取代理链路 IP

- **WHEN** 请求 header 包含 `x-forwarded-for: 119.29.29.29, 10.0.0.1`
- **THEN** chat.post.ts 提取第一个非内网 IP `119.29.29.29`，以【用户位置上下文】格式注入 prompt

#### Scenario: x-forwarded-for 全为内网 IP 时回退

- **WHEN** 请求 header 包含 `x-forwarded-for: 10.0.0.1, 192.168.1.1`
- **AND** `x-real-ip` 为空、`remoteAddress` 为 `127.0.0.1`
- **THEN** chat.post.ts 跳过 IP 注入，不向 prompt 追加任何内容

#### Scenario: 本地开发读取 socket 远端地址

- **WHEN** 请求未携带 `x-forwarded-for` 和 `x-real-ip` header
- **AND** `event.node.req.socket.remoteAddress` 为 `127.0.0.1`
- **THEN** chat.post.ts 注入「【用户位置上下文】用户当前请求 IP: 127.0.0.1...」到 prompt，LLM 调用 getCityByIp 后会得到 isLocal: true，应反问用户城市

#### Scenario: IP 为空时跳过注入

- **WHEN** 所有 IP 来源均为空或不可用（极端情况）
- **THEN** chat.post.ts 不向 prompt 追加 IP 信息，流程正常继续

#### Scenario: chat.post.ts 不直接调用业务函数

- **WHEN** 检查 chat.post.ts 的 import 语句
- **THEN** 不存在 `import { getCityByIp } from '~/server/tools/weather'` 或类似的业务函数直接导入

### Requirement: LLM 自主两步组合调用 getCityByIp 与 weather

当用户询问本地天气但未提供城市名时，LLM SHALL 自主决策调用顺序：先调用 `getCityByIp(ip)` 拿到城市，再调用 `weather(city)` 拿到天气，最后综合回答。本行为由 prompt 注入和工具 description 引导，不通过代码硬编码调用步骤。

#### Scenario: 用户未提供城市时 LLM 两步调用

- **WHEN** 用户发送「今天天气怎么样？」
- **AND** system prompt 中包含「【用户位置上下文】用户当前请求 IP: 119.29.29.29...」
- **THEN** LLM 自主调用 `getCityByIp({ ip: "119.29.29.29" })` 获取城市（如"深圳"）
- **AND** LLM 继续调用 `weather({ city: "深圳" })` 获取天气
- **AND** LLM 基于工具返回结果生成自然语言回答

#### Scenario: 用户已提供城市时 LLM 跳过 IP 定位

- **WHEN** 用户发送「北京今天天气怎么样？」
- **THEN** LLM 直接调用 `weather({ city: "北京" })`，不调用 `getCityByIp`
- **AND** 工具 description 中明确「用户已显式提供城市名时不应调用此工具」

#### Scenario: IP 定位失败时 LLM 反问用户

- **WHEN** LLM 调用 `getCityByIp` 返回 `isError: true` 或 `city: null`
- **THEN** LLM 应向用户反问「请告诉我你所在的城市」而非继续瞎猜

#### Scenario: 本地开发 IP 时 LLM 区分处理

- **WHEN** LLM 调用 `getCityByIp({ ip: "127.0.0.1" })` 返回 `isLocal: true, error: "本地/内网 IP，无法定位"`
- **THEN** LLM 识别为本地开发环境，反问用户「你在哪个城市？我帮你查天气」

### Requirement: getCityByIp 单元测试覆盖核心场景

`tests/unit/weather-ip.test.ts` SHALL 覆盖以下测试用例：合法公网 IP 成功（中文/英文返回）、本地/内网 IP 返回 isLocal 且不发 fetch、云元数据 IP 拦截、非法格式拒绝、含特殊字符注入拦截、ip-api.com 非 200 降级、ip-api.com status:fail 降级、fetch 超时降级。所有测试 MUST 使用 `vi.mock` 或 `vi.fn()` mock `fetch`，不发起真实 HTTP 请求。

#### Scenario: 测试公网 IP 成功路径

- **WHEN** mock `fetch` 返回 ip-api.com 成功响应（`{ status: "success", city: "深圳", regionName: "广东", country: "中国", ... }`）
- **THEN** `getCityByIp("119.29.29.29")` 解析返回包含 `city: "深圳"` 且 `isLocal` 为 false 的对象
- **AND** 验证 fetch 被调用 exactly 1 次，URL 中 IP 参数经 encodeURIComponent 编码

#### Scenario: 测试本地/内网 IP 短路不发请求

- **WHEN** 调用 `getCityByIp("127.0.0.1")`、`getCityByIp("192.168.1.1")`、`getCityByIp("10.0.0.1")`、`getCityByIp("172.16.0.1")`
- **THEN** 所有调用返回 `isLocal: true`
- **AND** mock fetch 未被调用（调用次数为 0）

#### Scenario: 测试非法 IP 和注入字符拦截

- **WHEN** 调用 `getCityByIp("not-an-ip")`、`getCityByIp("999.999.999.999")`、`getCityByIp("127.0.0.1\r\n")`
- **THEN** 所有调用返回非 null error，`city` 为 null
- **AND** mock fetch 未被调用

#### Scenario: 测试 ip-api.com 返回非 200 时降级

- **WHEN** mock `fetch` 返回 `{ ok: false, status: 500 }`
- **THEN** `getCityByIp("8.8.8.8")` 返回 `{ city: null, isLocal: false, error: 包含"暂时不可用" }`，不抛异常

#### Scenario: 测试 ip-api.com 返回 status:fail 时降级

- **WHEN** mock `fetch` 返回 `{ ok: true, json: () => Promise.resolve({ status: "fail", message: "reserved range" }) }`
- **THEN** `getCityByIp("8.8.8.8")` 返回 `{ city: null, isLocal: false, error: 包含"reserved range" }`

#### Scenario: 测试 fetch 超时降级

- **WHEN** mock `fetch` 使用 AbortSignal 触发超时
- **THEN** `getCityByIp("8.8.8.8")` 返回包含超时描述的 error 对象，不抛异常
