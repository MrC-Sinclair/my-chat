## Why

当前 weather 工具的 city 参数完全依赖用户在对话中显式提供城市名。但用户使用「今天天气怎么样？」这类引导语时，自然语义是「我所在的位置」，并未携带城市信息，导致 LLM 只能反问「你在哪个城市」或瞎猜，体验割裂。

客户端 IP 是请求级上下文，LLM 在标准 MCP 协议中拿不到。需要新增一个独立的 IP 定位 MCP 工具，让 LLM 在用户未提供城市时能自主调用获取大致位置，再组合调用 weather 工具完成查询，保持「工具职责单一 + LLM 自主组合」的 Agent 架构原则。

## What Changes

- 在 `server/tools/weather.ts` 新增 `getCityByIp(ip)` 核心函数，调用 IP 定位 API（ip-api.com）反查城市名，导出供 MCP Server 复用；通过严格 IP 格式校验 + URL encode + fetch 超时防止 SSRF
- 在 `server/mcp/weather-server.ts` 注册新 MCP 工具 `getCityByIp`，入参为 IP 字符串，返回城市名/区域信息
- 在 `server/api/chat.post.ts` 读取客户端请求 IP（`x-forwarded-for` / `x-real-ip`），将 IP 注入 system prompt，不直接调用任何业务函数
- 引导语 `quickPrompts` 中天气类提示词保持现状（已显式引导调用 weather 工具），由 LLM 自主决定是否先调 `getCityByIp` 再调 `weather`

**非改动项**（明确不在本次范围内）：
- 不修改现有 `weather` 工具的 schema（保持 `city` 必填）
- 不修改 `mcp-weather-tool` 的 spec 契约
- 不改造 MCP stdio 传输为 HTTP transport

## Capabilities

### New Capabilities

- `ip-location-tool`: 通过 MCP 协议暴露 IP 反查城市能力，与 weather 工具解耦，支持 LLM 自主两步组合调用（getCityByIp → weather）

### Modified Capabilities

（无）

## Impact

| 层级 | 影响范围 |
| --- | --- |
| 后端 - 工具核心层 | `server/tools/weather.ts` 新增 `getCityByIp()` 函数及 IP 定位 API 集成 |
| 后端 - MCP Server | `server/mcp/weather-server.ts` 注册新工具 `getCityByIp`，复用 weather.ts 核心函数 |
| 后端 - API 路由 | `server/api/chat.post.ts` 读取请求 IP 并注入 system prompt，不调用业务函数 |
| 文档 | 需同步更新 `docs/API.md`，补充 `getCityByIp` MCP 工具说明及部署时 `x-forwarded-for` 配置备注 |
| 数据库 | 本次不涉及 DB 变更，`docs/db-schema.md` 无需更新 |
| 配置 | 无新增环境变量（ip-api.com 免费版无需 Key） |
| 测试 | 需补充 `getCityByIp` 单元测试（mock fetch，覆盖格式校验、内网拒绝、API 失败降级等场景），MCP Server 集成测试覆盖新工具 |
| 兼容性 | 本地开发 IP（127.0.0.1/::1）反查会短路返回 isLocal，LLM 应反问用户 |
