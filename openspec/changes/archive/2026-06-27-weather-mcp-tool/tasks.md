## 1. 依赖升级

- [x] 1.1 升级 AI SDK：`pnpm add ai@^4.2.0`，验证升级后的版本兼容性
- [x] 1.2 安装 MCP 依赖：`pnpm add @ai-sdk/mcp @modelcontextprotocol/sdk`
- [x] 1.3 运行 `pnpm typecheck` 和 `pnpm lint` 验证升级后无编译错误

## 2. 重构 weather.ts 核心函数

- [x] 2.1 从 `weather.ts` 中导出 `geocodeCity`、`fetchWeather`、`describeWeatherCode`、`describeWindDirection` 核心函数
- [x] 2.2 删除 `weatherTool` 的 AI SDK `tool()` 定义（保留文件，仅移除 tool 导出）
- [x] 2.3 运行 `pnpm typecheck` 验证重构后无类型错误（仅 `weatherTool` 缺失是预期行为，将在 Task 4 修复）

## 3. 创建 MCP Weather Server

- [x] 3.1 创建 `server/mcp/weather-server.ts`，使用 `@modelcontextprotocol/sdk` 的 `McpServer` 定义 MCP Server
- [x] 3.2 在 MCP Server 中注册 `weather` 工具，复用 weather.ts 的核心函数
- [x] 3.3 配置 stdio 传输，确保 MCP Server 可独立运行
- [x] 3.4 测试 MCP Server 可用 `npx tsx server/mcp/weather-server.ts` 启动（通过 MCP Inspector 验证）

## 4. 集成 MCP Client 到 chat.post.ts

- [x] 4.1 在 `chat.post.ts` 中引入 `@ai-sdk/mcp` 的 `createMCPClient`
- [x] 4.2 创建 MCP Client 连接 MCP Weather Server（stdio transport）
- [x] 4.3 将 MCP 工具合并到 `streamText` 的 `tools` 参数中（与 `webSearchTool` 共存）
- [x] 4.4 运行 `pnpm typecheck` 和 `pnpm lint` 验证集成后无错误

## 5. 验证与测试

- [x] 5.1 启动开发服务器 `pnpm dev`，发送天气查询消息验证 LLM 能正常调用 MCP 天气工具
- [x] 5.2 验证流式输出（打字机效果）正常，MCP 工具调用不影响 SSE 流
- [x] 5.3 运行 `pnpm test:unit` 确保现有测试全部通过
- [x] 5.4 运行 `pnpm build` 确保生产构建成功
