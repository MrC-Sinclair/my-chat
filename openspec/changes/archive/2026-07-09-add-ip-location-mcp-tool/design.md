## Context

当前 `server/mcp/weather-server.ts` 通过 stdio 传输暴露 `weather` 工具，入参 `city` 必填。LLM 调用时必须从对话上下文中提取城市名，但用户使用「今天天气怎么样？」等引导语时未携带城市信息，导致 LLM 只能反问或瞎猜。

MCP stdio 架构的固有限制：MCP Server 是独立子进程，无法访问 `chat.post.ts` 的 HTTP 请求上下文（`event.node.req`、`x-forwarded-for`），因此无法在 MCP Server 内部自动读取客户端 IP。但 IP 反查城市本身是一个独立的"位置感知"能力，适合作为单独的 MCP 工具暴露给 LLM 自主调用。

现有相关代码：

- [server/tools/weather.ts](file:///d:/code/codeWork/my-chat/server/tools/weather.ts)：核心函数层，导出 `geocodeCity`、`fetchWeather` 等普通函数，文件头注释明确"供 MCP Server 和其他模块复用"
- [server/mcp/weather-server.ts](file:///d:/code/codeWork/my-chat/server/mcp/weather-server.ts)：MCP 协议封装层，复用 weather.ts 的函数注册 `weather` 工具
- [server/api/chat.post.ts](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts)：API 路由层，已有 prompt 注入先例（`OCR_TOOL_RULES`、`TIME_KEYWORDS` 触发的搜索提示）
- [server/tools/ocr-document.ts](file:///d:/code/codeWork/my-chat/server/tools/ocr-document.ts)：已有 SSRF 防护实现（协议白名单+域名白名单+内网 IP 黑名单+DNS 校验），作为内网 IP 段清单参考

## Goals / Non-Goals

**Goals:**

- 新增独立 MCP 工具 `getCityByIp`，入参为 IP 字符串，返回城市名/区域信息
- `chat.post.ts` 读取客户端请求 IP 并注入 system prompt，让 LLM 知道"用户当前 IP"这一上下文
- LLM 自主决定调用顺序：`getCityByIp(ip)` → `weather(city)`，符合 Agent 架构「LLM 自主决策 + 工具职责单一」原则
- 复用 weather.ts 的分层设计，新增的 `getCityByIp` 核心函数可被 MCP Server 和其他模块复用
- 对 IP 入参做严格安全校验，防止通过 URL 注入向内网发起请求

**Non-Goals:**

- 不修改现有 `weather` 工具的 schema（保持 `city` 必填，不引入"二选一"参数）
- 不改造 MCP stdio 传输为 HTTP transport
- 不实现高精度定位（IP 定位仅市级，区级精度不可靠）
- 不持久化用户位置到数据库（每次请求即时反查，不存储）
- 不实现用户手动设置默认城市的偏好系统（属于另一个独立能力）
- 不实现 IP 定位结果缓存（短期单用户场景无必要）
- 不做 DNS rebinding 防护（本工具始终连接固定的 ip-api.com，用户传入的 IP 是 URL 路径参数而非主机名，无 DNS rebinding 风险）

## Decisions

### Decision 1: IP 定位 API 选型 — ip-api.com

**选择**：ip-api.com 免费 HTTP 接口（`http://ip-api.com/json/{ip}?lang=zh&fields=status,message,city,regionName,country,lat,lon`）

**理由**：

- 完全免费、无需注册、无需 API Key
- 支持中文返回（`lang=zh`），无需本地翻译
- 返回字段包含 `city`、`regionName`、`country`、`lat`、`lon`，满足需求
- 免费版限流 45 次/分钟，对本项目（单用户对话场景）完全够用
- 已有先例：项目 weather.ts 使用 Open-Meteo 也是免费无 Key API，架构一致

**备选方案**：

- `ipinfo.io`：免费版 50000/月，支持 HTTPS，但需注册 token，引入额外环境变量
- `ipapi.co`：免费版 1000/天，HTTPS，但限流更严
- 本地 MaxMind GeoLite2 数据库：完全离线，精度高，但需下载二进制库（约 70MB）和定期更新机制，部署复杂度高

**为什么不选 ipinfo.io**：虽然支持 HTTPS，但本项目 MCP Server 调用 ip-api.com 是服务端出站行为，不经过浏览器，HTTP 无 mixed content 问题；多一个环境变量管理反而增加配置复杂度。若未来部署环境要求全 HTTPS 出站，可平滑切换到 ipinfo.io。

### Decision 2: 工具职责拆分 — 新增独立 `getCityByIp` 工具，不改造 `weather` 工具

**选择**：在 `weather-server.ts` 注册新 MCP 工具 `getCityByIp(ip)`，独立于 `weather(city)`

**理由**：

- 符合 [AGENTS.md](file:///d:/code/codeWork/my-chat/AGENTS.md)「一个工具只做一件事，组合交给 LLM」原则
- IP 定位能力可独立用于其他场景（时区推断、附近内容推荐等），不应耦合到 weather 工具
- weather 工具的 spec 契约保持不变，不破坏现有 [mcp-weather-tool spec](file:///d:/code/codeWork/my-chat/openspec/specs/mcp-weather-tool/spec.md)

**备选方案**：

- 改造 weather 工具，让 `city` 变可选，新增可选 `ip` 参数二选一 → 违反职责单一原则，且 weather 工具 spec 需修改
- 在 chat.post.ts 直接调 `getCityByIp()` 拿城市后注入 prompt（不暴露为 MCP 工具）→ 破坏 MCP 架构一致性，weather.ts 核心函数被项目代码直接调用

### Decision 3: chat.post.ts 仅做"读 IP + 注入 prompt"，不调用业务函数

**选择**：`chat.post.ts` 读取 `x-forwarded-for` / `x-real-ip` header 拿到 IP 后，直接拼接到 system prompt 末尾，格式为：

```
【用户位置上下文】用户当前请求 IP: {ip}，如需定位用户所在城市请调用 getCityByIp 工具传入该 IP。
```

**理由**：

- chat.post.ts 不 import 任何 weather.ts 的业务函数（当前只 import `webSearchTool` 和 `ocrDocumentTool`）。`getClientIp` 中使用内联的 IP 网段判断（约 4 行正则），不依赖 weather.ts 的 `isPrivateIp` 工具函数
- "读 IP"是 HTTP 请求上下文操作，MCP stdio 进程做不到，只能在 API 路由层做
- "注入 prompt"是已有模式（参考 [OCR_TOOL_RULES](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L63-L84) 和 [TIME_KEYWORDS 触发的搜索提示](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L299-L303)），使用【标签】前缀与现有风格一致
- LLM 看到 prompt 里的 IP 后，自主决定是否调用 `getCityByIp`（如果用户已提供城市名，LLM 可直接调 weather，跳过 IP 定位）

**备选方案**：

- chat.post.ts 调 `getCityByIp()` 同步拿到城市后注入 prompt → 上面已分析，破坏 MCP 一致性
- 把 IP 注入到 messages 数组的 user 消息中 → 污染用户消息内容，影响持久化和后续对话

### Decision 4: SSRF 防护策略 — IP 格式严格校验 + URL encode + fetch 超时（不做 DNS 校验）

**选择**：`getCityByIp(ip)` 函数入口执行以下安全校验：

1. **严格 IP 格式正则校验**（IPv4: 四段 0-255；IPv6: 标准冒号十六进制格式），不合法直接返回错误
2. **内网/保留地址黑名单**入口短路（不发起 HTTP 请求），覆盖以下网段：
   - IPv4: `127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`（含云元数据 `169.254.169.254`）、`0.0.0.0`
   - IPv6: `::1`、`fe80::/10`（link-local）、`fc00::/7`（ULA，含 `fd00::/8`）
3. **URL 路径参数编码**：构造请求 URL 时使用 `encodeURIComponent(ip)` 防御性编码，防止 CRLF（`\r\n`）、`/`、`@` 等特殊字符注入导致路径逃逸
4. **fetch 超时**：使用 `AbortController` 设置 10 秒超时，防止网络挂起导致 MCP 工具调用卡住（参考 OCR 工具的 30 秒超时模式）
5. **不做 DNS 双重校验**：本工具始终连接固定主机 `ip-api.com`，用户传入的 IP 仅作为 URL 路径参数，不存在 DNS rebinding 攻击面（DNS rebinding 需要攻击者控制连接目标主机名，本场景不满足此前提）

**理由**：

- 与 OCR 工具有本质区别：OCR 工具接收用户传入的任意 URL（可能指向内网），需要 DNS 校验防 rebinding；本工具连接目标固定，IP 仅作路径参数，DNS 校验在语义上无意义（传入的是 IP 字符串而非主机名，对它做 `dns.lookup` 要么直接返回该 IP 要么报错）
- 内网 IP 黑名单的主要目的是**节省 API 调用**和**快速反馈**，而非核心安全防线——核心防线是格式校验+URL encode
- 复用 OCR 工具已有的内网 IP 段清单（[ocr-document.ts:52-63](file:///d:/code/codeWork/my-chat/server/tools/ocr-document.ts#L52-L63)），保持项目防护一致性

**为什么不做 DNS 双重校验**：
- 用户传入的 IP 是路径参数，不是主机名，连接目标始终是 ip-api.com
- 对 IP 字符串做 `dns.lookup` 语义错误，无法防御任何实际攻击
- 如未来新增"根据域名定位"等功能，届时再引入 DNS 校验

**备选方案**：

- 照搬 OCR 工具的"DNS 双重校验"模式 → 不适用于本场景，增加无效复杂度（已排除）
- 仅格式校验不做内网黑名单 → 本地开发 IP 会白白消耗一次 API 调用，且反馈慢

### Decision 5: 本地开发 fallback 策略 — 短路返回 isLocal 标记

**选择**：当 IP 为 `127.0.0.1` / `::1` / 内网地址时，`getCityByIp` 在入口黑名单校验阶段直接返回结构化结果：

```json
{ "city": null, "region": null, "country": null, "lat": null, "lon": null, "isLocal": true, "error": "本地/内网 IP，无法定位" }
```

`isLocal: true` 区分"本地/内网环境"（非故障）和"API 故障"（`isLocal: false, error: "..."`）。MCP 包装层对所有 `city: null` 的返回统一设置 `isError: true`（与现有 weather 工具"城市不存在时返回 isError: true"的模式一致），LLM 通过 `isLocal` 字段区分两种失败原因：本地环境时反问用户城市，API 故障时告知用户稍后重试。

**理由**：

- 本地开发场景 IP 反查无意义，调用 ip-api.com 会返回失败或空数据，浪费一次请求
- 明确返回 `isLocal: true` 让 LLM 能区分"API 故障"和"本地开发/内网环境"，给出更合理的回应
- 不在代码里硬编码"本地默认城市"（如默认北京），避免误导
- 内网 IP 同理（如云服务器内网 IP、容器网络 IP），定位无意义

### Decision 6: API 错误处理策略 — 失败不抛异常，返回错误对象

**选择**：`getCityByIp` 函数内部所有失败路径（格式校验失败、内网拦截、网络错误、API 返回非 200、API 返回 status:"fail"、JSON 解析失败、超时）均返回 `{ city: null, region: null, country: null, isLocal: false, error: string }` 结构化对象，不 throw。

**理由**：

- 符合 [AGENTS.md](file:///d:/code/codeWork/my-chat/AGENTS.md)「执行失败返回 `{ error, detail }` 不 throw，由 LLM 决定重试/换工具」原则
- MCP Server 注册的工具包装层也遵循同样模式（参考 [weather-server.ts:115-126](file:///d:/code/codeWork/my-chat/server/mcp/weather-server.ts#L115-L126) 的 try-catch 返回 `isError: true`）
- LLM 拿到错误后可以自主决定：反问用户城市 / 告知用户定位失败

## Risks / Trade-offs

- **[风险] 生产部署代理 IP 不准确** → 文档说明部署时需正确配置 `x-forwarded-for` 信任链。当前策略"取第一个非内网 IP"适配 Vercel/Cloudflare 等覆盖式代理（默认覆盖伪造的 header）。若部署到自建 Nginx（appending 模式：`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`），攻击者可注入伪造的 `X-Forwarded-For` 头部，导致拿到错误 IP。**影响**：仅限天气查询不准确，不涉及安全或认证，可接受。若未来 IP 定位用于敏感场景，需改为从右向左取第一个受信任的 IP
- **[风险] ip-api.com 限流（45次/分钟）** → 单用户对话场景远低于限流，但若未来多用户并发需监控。短期不引入缓存（IP 反查结果可能变化），长期可考虑加 5 分钟内存缓存
- **[风险] LLM 不主动调用 getCityByIp** → 通过 prompt 注入明确提示【用户位置上下文】，且工具 description 强语义化（"当用户未提供城市名但询问本地信息或天气时调用此工具"）。无法 100% 保证，符合 Agent 架构原则（LLM 自主决策）
- **[风险] 两步 MCP 调用增加延迟** → getCityByIp 约 200-500ms，weather 约 300-800ms，总延迟 500-1300ms。在 maxSteps=5 限制内可接受。备选：未来可考虑增加"weatherByIp"复合工具优化延迟，但本次不做
- **[权衡] HTTP（非 HTTPS）调用 ip-api.com** → 服务端出站调用不经过浏览器，无 mixed content 问题。但若未来项目部署到要求全部 HTTPS 出站的环境（如某些企业内网），需切换到 ipinfo.io（仅需改接口 URL，核心逻辑不变）
- **[权衡] IP 定位精度仅市级** → 区级以下不可靠，但对天气查询场景足够（同城市天气差异极小）
- **[风险] IPv6 地址格式校验的正则复杂度** → IPv6 有多种合法写法（含 `::` 压缩、IPv4 内嵌等），正则过于宽松可能漏过滤，过于严格可能误伤合法地址。实现时使用经过验证的 IPv6 正则，必要时使用 Node.js 内置 `net.isIP()` 函数辅助校验
