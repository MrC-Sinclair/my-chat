## Why

当前天气工具使用 AI SDK 的 `tool()` 函数，与 Nuxt 服务端同进程运行。将天气工具改造为 MCP (Model Context Protocol) Server，可以解耦工具逻辑与主应用，使天气工具可被其他 MCP 客户端（如 Claude Desktop）复用，同时为后续引入更多 MCP 工具（GitHub、文件系统等）打下基础。

## What Changes

- 升级 AI SDK 从 v4.1.0 到 v4.2+（支持 `@ai-sdk/mcp`）
- 创建独立 MCP Weather Server (`server/mcp/weather-server.ts`)，使用 `@modelcontextprotocol/sdk`
- 重构 `server/tools/weather.ts`：分离核心函数（`geocodeCity`、`fetchWeather` 等）与工具定义，导出给 MCP Server 复用
- 在 `chat.post.ts` 中通过 `@ai-sdk/mcp` 的 `createMCPClient` 连接 MCP Weather Server
- 删除原有的 AI SDK `weatherTool` 定义（由 MCP 工具替代）
- 保留 `webSearchTool` 不变（仍使用 AI SDK 原生方式）

## Capabilities

### New Capabilities

- `mcp-weather-tool`: 基于 MCP 协议的天气查询工具，通过独立 MCP Server 进程提供天气查询能力，可被 AI SDK 和外部 MCP 客户端复用

### Modified Capabilities

<!-- 无现有 spec 需要修改 -->

## Impact

| 层级       | 影响                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| 依赖       | 新增 `@ai-sdk/mcp`、`@modelcontextprotocol/sdk`；升级 `ai` 到 v4.2+              |
| 服务端工具 | `weather.ts` 重构为导出核心函数 + MCP Server 入口；删除 `weatherTool`            |
| API 路由   | `chat.post.ts` 中工具注册方式从直接引用 `weatherTool` 改为通过 `createMCPClient` |
| 数据流     | 天气查询从同进程调用变为跨进程（stdio）MCP 协议调用                              |
| 前端       | 无影响（工具调用逻辑对前端透明）                                                 |
| 数据库     | 无影响                                                                           |
