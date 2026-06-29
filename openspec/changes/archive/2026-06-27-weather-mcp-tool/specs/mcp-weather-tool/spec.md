## ADDED Requirements

### Requirement: MCP Weather Server 提供天气查询工具

MCP Weather Server SHALL 通过 MCP 协议暴露 `weather` 工具，接受城市名称参数，返回该城市的实时天气和未来 3 天预报。

#### Scenario: 查询中国城市天气成功

- **WHEN** MCP 客户端调用 `weather` 工具，传入 `{ city: "深圳" }`
- **THEN** Server 返回包含当前温度、体感温度、湿度、天气状况、风速、风向，以及未来 3 天预报（最高/最低温度、天气状况、降水概率）的结构化数据

#### Scenario: 查询英文城市名天气成功

- **WHEN** MCP 客户端调用 `weather` 工具，传入 `{ city: "Tokyo" }`
- **THEN** Server 返回东京的天气数据，格式与中文城市名查询一致

#### Scenario: 城市名不存在

- **WHEN** MCP 客户端调用 `weather` 工具，传入 `{ city: "不存在的城市名xyz" }`
- **THEN** Server 返回错误信息，包含 `isError: true` 标记和提示文本

#### Scenario: Open-Meteo API 不可用

- **WHEN** Open-Meteo API 返回非 200 状态码
- **THEN** Server 返回错误信息，包含 `isError: true` 标记和错误描述

### Requirement: AI SDK 通过 MCP Client 连接 Weather Server

Nuxt 服务端 SHALL 通过 `@ai-sdk/mcp` 的 `createMCPClient` 连接 MCP Weather Server，并在 `streamText` 的 `tools` 参数中注册 MCP 工具。

#### Scenario: streamText 注册 MCP 天气工具

- **WHEN** `chat.post.ts` 调用 `streamText()`
- **THEN** `tools` 参数中包含从 MCP Client 获取的 `weather` 工具，以及原有的 `webSearch` 工具

#### Scenario: LLM 调用 MCP 天气工具

- **WHEN** 用户发送"深圳今天天气怎么样"
- **THEN** LLM 通过 MCP 协议调用 Weather Server 的 `weather` 工具，获取天气数据后生成自然语言回答

#### Scenario: MCP Server 进程未启动时的降级处理

- **WHEN** MCP Weather Server 进程未运行或无法连接
- **THEN** AI SDK 返回工具调用失败，LLM 应告知用户"天气查询暂时不可用"

### Requirement: weather.ts 核心函数可被 MCP Server 复用

`server/tools/weather.ts` SHALL 导出核心函数（`geocodeCity`、`fetchWeather`、`describeWeatherCode`、`describeWindDirection`），供 MCP Server 直接导入使用。

#### Scenario: MCP Server 导入核心函数

- **WHEN** `server/mcp/weather-server.ts` 导入 `geocodeCity` 等函数
- **THEN** 函数可正常调用，返回与原有 AI SDK 工具相同的数据格式

#### Scenario: 核心函数独立于 AI SDK

- **WHEN** 删除 `weatherTool` 导出后
- **THEN** 核心函数仍然可被其他模块导入使用，不依赖 AI SDK 的 `tool()` 函数
