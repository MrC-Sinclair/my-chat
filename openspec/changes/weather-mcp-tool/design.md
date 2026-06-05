## Context

当前项目使用 AI SDK v4.1.0，天气工具通过 `tool()` 函数定义在 `server/tools/weather.ts`，与 Nuxt 服务端同进程运行。AI SDK 从 v4.2 开始通过 `@ai-sdk/mcp` 包支持 MCP 协议，允许通过 `createMCPClient` 连接外部 MCP Server。

MCP (Model Context Protocol) 是 Anthropic 推出的开放标准，用于标准化 AI 应用与外部工具/数据源的连接方式。MCP Server 通过 stdio 或 HTTP 传输与客户端通信，暴露 tools、resources、prompts 等能力。

## Goals / Non-Goals

**Goals:**
- 将天气查询逻辑从 AI SDK `tool()` 迁移到独立 MCP Server
- 天气工具可通过 MCP 协议被 AI SDK 和外部 MCP 客户端（如 Claude Desktop）复用
- 升级 AI SDK 到支持 MCP 的版本（v4.2+）
- 保持现有 LLM 调用天气工具的行为不变（对用户透明）

**Non-Goals:**
- 不改造 `webSearchTool`（保留 AI SDK 原生方式）
- 不修改前端 UI 或消息渲染逻辑
- 不修改数据库 schema
- 不改动天气查询的核心 API 调用逻辑（Open-Meteo）

## Decisions

### Decision 1: 使用 stdio 传输而非 HTTP

**选择**: MCP Server 与 Nuxt 进程之间使用 stdio 传输

**理由**:
- 天气工具仅在本地 Nuxt 服务端使用，不需要跨网络访问
- stdio 无需端口管理，无网络配置复杂度
- `@ai-sdk/mcp` 的 `createMCPClient` 原生支持 stdio transport
- 如需远程访问，后续可切换到 Streamable HTTP 传输

**替代方案**: Streamable HTTP 传输 — 适合需要远程访问或多客户端共享的场景，但当前需求不需要

### Decision 2: 重构 weather.ts 而非重写

**选择**: 将 `weather.ts` 中的核心函数（`geocodeCity`、`fetchWeather`、`describeWeatherCode` 等）导出，MCP Server 直接复用

**理由**:
- 避免重复实现 Open-Meteo API 调用逻辑
- 减少回归风险
- 后续如需切换回 AI SDK 原生方式，代码仍然可用

### Decision 3: 升级 AI SDK 到 v4.2+

**选择**: 升级 `ai` 包到 `^4.2.0`，新增 `@ai-sdk/mcp`

**理由**:
- AI SDK v4.2 是首个支持 MCP 的版本
- 项目当前使用 v4.1.0，升级路径短，breaking changes 少
- `@ai-sdk/mcp` 提供 `createMCPClient` 和自动工具发现

**风险**: AI SDK 升级可能引入 breaking changes，需验证 `streamText` 行为和推理提供者兼容性

### Decision 4: MCP Server 作为独立脚本运行

**选择**: MCP Server 放在 `server/mcp/weather-server.ts`，通过 `npx tsx` 在开发环境运行

**理由**:
- MCP Server 是独立进程，不应与 Nuxt 构建产物耦合
- 开发环境用 `tsx` 直接运行 TypeScript
- 生产环境可预编译为 JS 后通过 `node` 运行

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| AI SDK 升级 v4.1→v4.2 可能引入 breaking changes | 升级后运行 `pnpm typecheck` + `pnpm test:unit` 验证 |
| MCP Server 进程崩溃导致天气工具不可用 | AI SDK 的 `createMCPClient` 会在工具调用失败时返回错误，LLM 可告知用户"天气查询暂时不可用" |
| stdio 通信增加延迟（约 10-50ms） | 天气查询本身需要网络请求（~200ms），stdio 开销可忽略 |
| `chat.post.ts` 中 MCP 工具注册方式与原有 AI SDK 工具混用 | 已验证 AI SDK 支持 `tools` 参数中同时使用 MCP 工具和原生工具 |