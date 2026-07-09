# API 接口文档

基于 Nuxt 3 Server Routes，所有接口前缀为 `/api`。基础地址开发环境为 `http://localhost:3000`。

## 总览

| 方法     | 路径                | 说明                           | 鉴权 |
| -------- | ------------------- | ------------------------------ | ---- |
| `POST`   | `/api/chat`         | AI 对话（流式 SSE）            | 无   |
| `GET`    | `/api/sessions`     | 获取会话列表                   | 无   |
| `POST`   | `/api/sessions`     | 创建新会话                     | 无   |
| `GET`    | `/api/sessions/:id` | 获取会话历史消息               | 无   |
| `PATCH`  | `/api/sessions/:id` | 重命名会话                     | 无   |
| `DELETE` | `/api/sessions/:id` | 删除会话（级联删除消息和反馈） | 无   |
| `GET`    | `/api/models`       | 获取可用模型列表               | 无   |

## 通用约定

### 请求

- 请求体统一使用 `application/json`（`/api/chat` 的流式响应除外）
- 会话 ID 必须为标准 UUID v4 格式，否则返回 `400 会话ID格式无效`
- 所有 `/api/*` 路径受中间件限流保护

### 响应

- 成功响应：HTTP 2xx + JSON body
- 错误响应：HTTP 4xx/5xx + Nuxt `createError` 标准格式

```json
{
  "statusCode": 400,
  "statusMessage": "messages 参数缺失或格式错误",
  "data": {}
}
```

### 安全中间件

所有 `/api/*` 请求经过 [security.ts](file:///d:/code/my-chat/server/middleware/security.ts) 中间件，统一处理：

| 能力             | 配置                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| CSP              | `default-src 'self'`；`script-src` 允许 `'unsafe-inline' 'unsafe-eval'`；`connect-src` 仅允许硅基流动 |
| 安全响应头       | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`   |
| CORS             | 仅允许 `http://localhost:3000`，支持 `GET/POST/PATCH/DELETE/OPTIONS`                                  |
| 限流             | 60 秒内最多 30 次/IP，超出返回 `429`，响应头 `X-RateLimit-Remaining` / `X-RateLimit-Limit`            |
| 会话 ID 格式校验 | `/api/sessions/:id` 路径必须匹配 UUID 正则                                                            |

---

## 接口详情

### POST /api/chat

AI 对话核心接口，使用 Vercel AI SDK 的 `streamText` 流式生成回复，返回 SSE 流（UIMessageChunk 格式）。

**请求体**

| 字段                | 类型            | 必填 | 默认值               | 说明                                                                                                  |
| ------------------- | --------------- | ---- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `messages`          | `UIMessage[]`   | 是   | —                    | 对话历史，最后一个为当前用户消息。注意：`system` 角色消息会被服务端过滤，最终使用服务端 system prompt |
| `sessionId`         | `string` (UUID) | 否   | —                    | 会话 ID，传入时会在 `onFinish` 中持久化用户消息和 AI 回复                                             |
| `model`             | `string`        | 否   | `LLM_MODEL` 环境变量 | 模型标识，必须在 `/api/models` 白名单内，否则回退到默认模型                                           |
| `enable_thinking`   | `boolean`       | 否   | `true`               | 是否启用深度思考（仅对非视觉、非推理模型生效）                                                        |
| `thinking_budget`   | `number`        | 否   | —                    | 思考预算（保留字段，当前未使用）                                                                      |
| `images`            | `string[]`      | 否   | —                    | 图片数组，元素为 `data:image/...;base64,...` 或公网 URL                                               |
| `enable_web_search` | `boolean`       | 否   | `true`               | 是否启用网页搜索工具                                                                                  |
| `enable_ocr`        | `boolean`       | 否   | `false`              | 是否启用 OCR 工具（`extractTextFromImage`），仅 `toolCalling` 模型生效，默认关闭                      |

**messages 元素结构**（AI SDK v5 UIMessage）

```ts
{
  role: 'user' | 'assistant' | 'system',
  parts?: Array<{ type: 'text', text: string }>,  // v5 推荐格式
  content?: string                                 // 旧格式兼容
}
```

**限制**

| 限制项                 | 值        | 触发错误码 |
| ---------------------- | --------- | ---------- |
| 单条消息长度           | 1000 字符 | `400`      |
| 上下文消息数           | 50 条     | 自动截断   |
| 单次图片数量           | 5 张      | `400`      |
| 单张图片大小           | 4 MB      | `400`      |
| 未配置 `IMGBB_API_KEY` | —         | `400`      |

**模型能力与工具可用性**

不同模型的能力差异会影响工具调用行为：

| 模型                             | vision | reasoning | toolCalling | maxSteps | 天气 | 网页搜索 | OCR | 深度思考 |
| -------------------------------- | ------ | --------- | ----------- | -------- | ---- | -------- | --- | -------- |
| Qwen/Qwen3-8B                    | —      | —         | ✓           | 5        | ✓    | ✓        | ✓   | ✓        |
| Qwen/Qwen3.5-4B                  | ✓      | —         | ✓           | 5        | ✓    | ✓        | ✓   | ✓        |
| deepseek-ai/DeepSeek-R1-0528-... | —      | ✓         | —           | 1        | ✗    | ✗        | ✗   | —        |
| THUDM/GLM-Z1-9B-0414             | —      | ✓         | ✓           | 5        | ✓    | ✓        | ✓   | —        |
| THUDM/GLM-4.1V-9B-Thinking       | ✓      | ✓         | —           | 1        | ✗    | ✗        | ✗   | —        |

> `maxSteps` 由 `hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0` 决定：有可用工具时为 5（允许多步工具调用），无工具时为 1（仅一轮生成）。天气、网页搜索、OCR 工具均依赖 `toolCalling`；网页搜索额外要求 `!vision`（产品决策，视觉模型不暴露前端按钮）。OCR 工具需通过 `enable_ocr: true` 显式开启。

**图片处理流程**

1. `data:` 开头的 base64 图片先保存到 `public/uploads/`，再上传到 ImgBB 获取公网 URL
2. 上传失败时降级使用 base64 原值
3. 公网 URL 图片直接使用
4. 仅最后一条用户消息会附带图片，作为多模态 content parts 传入 LLM

**响应**

`Content-Type: text/event-stream`，按 [UIMessageChunk](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot#streaming-protocol) 协议推送，主要事件类型：

| 事件类型                | 字段                              | 说明                         |
| ----------------------- | --------------------------------- | ---------------------------- |
| `start`                 | `messageId`                       | 流开始                       |
| `start-step`            | —                                 | 单步开始（多步工具调用场景） |
| `reasoning-start`       | `id`                              | 思考过程开始                 |
| `reasoning-delta`       | `id`, `delta`                     | 思考过程增量                 |
| `reasoning-end`         | `id`                              | 思考过程结束                 |
| `text-start`            | `id`                              | 正式回答开始                 |
| `text-delta`            | `id`, `delta`                     | 正式回答增量（打字机效果）   |
| `text-end`              | `id`                              | 正式回答结束                 |
| `tool-input-start`      | `toolCallId`, `toolName`          | 工具调用开始                 |
| `tool-input-delta`      | `toolCallId`, `inputTextDelta`    | 工具入参增量                 |
| `tool-input-available`  | `toolCallId`, `toolName`, `input` | 工具入参就绪                 |
| `tool-output-available` | `toolCallId`, `output`            | 工具结果就绪                 |
| `tool-output-error`     | `toolCallId`, `errorText`         | 工具调用失败                 |
| `error`                 | `errorText`                       | 流错误                       |
| `finish`                | `finishReason`                    | 流结束                       |
| `finish-step`           | —                                 | 单步结束                     |

**思考过程（reasoning）处理**

硅基流动等兼容 API 在 SSE 的 `delta.reasoning_content` 中返回思考内容，但 `@ai-sdk/openai` v2 不解析该字段。`reasoning-provider.ts` 通过自定义 fetch 拦截 SSE 流，将 `reasoning_content` 映射为带 `\x00REASONING:` 前缀的 `content`，再由 `chat.post.ts` 拆分为 `reasoning-*` 事件推送到前端。

**持久化**

仅当传入 `sessionId` 时，在 `streamText` 的 `onFinish` 回调中：

1. 从最终文本中剥离 reasoning 标记内容，得到 `cleanText`
2. 反向查找最后一条 `user` 消息，插入 `messages` 表（附带图片元数据）
3. 插入 `assistant` 消息（`metadata.model` 记录使用的模型）
4. 更新 `sessions.updatedAt`

**示例**

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "parts": [{ "type": "text", "text": "你好" }] }
    ],
    "sessionId": "00000000-0000-4000-8000-000000000000",
    "model": "Qwen/Qwen3-8B",
    "enable_thinking": true
  }'
```

**错误码**

| 状态码 | 触发条件                                       |
| ------ | ---------------------------------------------- |
| `400`  | `messages` 缺失/非数组；单条消息超长；图片超限 |
| `400`  | 启用图片但未配置 `IMGBB_API_KEY`               |
| `429`  | 触发限流                                       |
| `500`  | `streamText` 调用失败                          |

---

### GET /api/sessions

获取所有会话列表，按 `updatedAt` 降序排列，附带每个会话的消息数量。

**请求参数**：无

**响应**：`SessionListItem[]`

```ts
interface SessionListItem {
  id: string
  title: string
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
  messageCount: number
}
```

**示例响应**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "新对话 2026/6/22 14:30:00",
    "createdAt": "2026-06-22T06:30:00.000Z",
    "updatedAt": "2026-06-22T07:00:00.000Z",
    "messageCount": 12
  }
]
```

---

### POST /api/sessions

创建新会话。

**请求体**（可选）

| 字段    | 类型     | 必填 | 默认值                   | 说明     |
| ------- | -------- | ---- | ------------------------ | -------- |
| `title` | `string` | 否   | `新对话 ${当前本地时间}` | 会话标题 |

**响应**：`Session`

```ts
interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}
```

**示例**

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{ "title": "React 学习" }'
```

---

### GET /api/sessions/:id

获取指定会话的所有历史消息，按 `createdAt` 升序排列（最早消息在前）。

**路径参数**

| 字段 | 类型            | 必填 | 说明                 |
| ---- | --------------- | ---- | -------------------- |
| `id` | `string` (UUID) | 是   | 会话 ID，必须为 UUID |

**响应**：`Message[]`

```ts
interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: Record<string, unknown> | null
  createdAt: string
}
```

**metadata 字段说明**

- `user` 消息：若包含图片，`metadata.images = [{ index, url }]`
- `assistant` 消息：`metadata.model = "Qwen/Qwen3-8B"`

**错误码**

| 状态码 | 触发条件          |
| ------ | ----------------- |
| `400`  | `id` 非 UUID 格式 |

---

### PATCH /api/sessions/:id

重命名会话。

**路径参数**：`id`（UUID）

**请求体**

| 字段    | 类型     | 必填 | 说明         |
| ------- | -------- | ---- | ------------ |
| `title` | `string` | 是   | 新标题，非空 |

**响应**

```json
{ "success": true }
```

**错误码**

| 状态码 | 触发条件                   |
| ------ | -------------------------- |
| `400`  | `id` 非 UUID；`title` 为空 |

---

### DELETE /api/sessions/:id

删除会话。`messages` 和 `feedbacks` 表通过外键 `onDelete: 'cascade'` 级联删除。

**路径参数**：`id`（UUID）

**响应**

```json
{ "success": true }
```

**错误码**

| 状态码 | 触发条件          |
| ------ | ----------------- |
| `400`  | `id` 非 UUID 格式 |

---

### GET /api/models

返回当前 LLM Provider 支持的可用模型白名单。前端用于动态切换模型。

**请求参数**：无

**响应**：`ModelConfig[]`

```ts
interface ModelConfig {
  label: string // 前端显示名称
  value: string // 模型唯一标识，对应 /api/chat 的 model 参数
  capabilities: {
    vision: boolean // 是否支持图片理解
    reasoning: boolean // 是否支持深度思考
    toolCalling: boolean // 是否支持工具调用
  }
}
```

**示例响应**

```json
[
  {
    "label": "Qwen3-8B",
    "value": "Qwen/Qwen3-8B",
    "capabilities": { "vision": false, "reasoning": false, "toolCalling": true }
  },
  {
    "label": "DeepSeek-R1-0528-Qwen3-8B",
    "value": "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    "capabilities": { "vision": false, "reasoning": true, "toolCalling": false }
  },
  {
    "label": "GLM-4.1V-9B-Thinking",
    "value": "THUDM/GLM-4.1V-9B-Thinking",
    "capabilities": { "vision": true, "reasoning": true, "toolCalling": false }
  }
]
```

> 模型白名单定义在 [server/config/models.ts](file:///d:/code/my-chat/server/config/models.ts)，新增模型需同步此文件。

---

## AI 工具

`/api/chat` 在调用 LLM 时会根据模型能力和请求参数注册以下工具。工具调用通过 `tool-*` 事件推送到前端，由 `ToolInvocation.vue` 组件展示。

### weather（MCP 工具）

通过 MCP 协议（stdio 传输）连接独立的 [weather-server.ts](file:///d:/code/my-chat/server/mcp/weather-server.ts) 子进程，仅对支持 `toolCalling` 的模型注册。

**输入**

```ts
{
  city: string
} // 城市名，支持中文或英文
```

**输出**（JSON 字符串）

```ts
{
  city: string,
  region: string,
  country: string,
  current: {
    temperature: string,      // "26°C"
    feelsLike: string,        // "28°C"
    humidity: string,         // "70%"
    condition: string,        // "晴朗"
    windSpeed: string,        // "10 km/h"
    windDirection: string     // "东南风"
  },
  forecast: Array<{
    day: '今天' | '明天' | '后天',
    condition: string,
    high: string,
    low: string,
    rainChance: string
  }>,
  coordinates: { latitude: number, longitude: number }
}
```

**数据源**：[Open-Meteo](https://open-meteo.com/) Geocoding API + Weather API（免费、无需 Key）

### getCityByIp（MCP 工具）

通过 MCP 协议（stdio 传输）连接独立的 [weather-server.ts](file:///d:/code/my-chat/server/mcp/weather-server.ts) 子进程，仅对支持 `toolCalling` 的模型注册。当用户未显式提供城市名但询问本地天气或位置信息时调用此工具；用户已显式提供城市名时不应调用此工具，直接使用 `weather` 工具。

**输入**

```ts
{
  ip: string  // IPv4 或 IPv6 地址
}
```

**输出**（成功，JSON 字符串）

```ts
{
  city: string,        // 城市名（中文，由 ip-api.com lang=zh 返回）
  region: string,       // 省份/地区
  country: string,     // 国家（中文）
  lat: number,          // 纬度
  lon: number,          // 经度
  isLocal: false,       // 是否本地/内网 IP
  error: null           // 错误信息（成功时为 null）
}
```

**输出**（失败，`isError: true`，不抛异常由 LLM 决定后续动作）

```ts
{
  city: null,
  region: null,
  country: null,
  lat: null,
  lon: null,
  isLocal: boolean,    // true 表示因命中内网/保留地址而短路
  error: string        // 错误信息：
                       //   '本地/内网 IP，无法定位'（isLocal=true）
                       //   'IP 格式无效：...'（格式校验失败）
                       //   'IP 定位服务暂时不可用'（HTTP 5xx/网络错误）
                       //   'IP 定位超时（10秒）'（AbortController 超时）
                       //   '...'（ip-api.com 返回 fail 时透传 message）
}
```

**调用约束与 SSRF 防护**

- IP 格式严格校验（IPv4 四段 0-255 / IPv6 标准冒号十六进制），拒绝 `127.0.0.1\r\n`、`127.0.0.1@evil.com` 等注入
- 内网/保留地址短路返回 `isLocal: true`，不发 HTTP 请求：
  - IPv4：`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`（含云元数据 169.254.169.254）、`0.0.0.0`
  - IPv6：`::1`、`fe80::/10`、`fc00::/7`（含 `fd00::/8`）
- 使用 `encodeURIComponent(ip)` 构造 URL，防御 CRLF / `@` 注入
- `AbortController` 10 秒超时
- **不做 DNS 二次校验**：用户输入作为 URL path 参数（非 host），DNS rebinding 不适用
- IP 透传机制：`chat.post.ts` 通过 `getClientIp(event)` 读取 `x-forwarded-for` / `x-real-ip` / `socket.remoteAddress`，注入到 system prompt 引导 LLM 调用此工具

**数据源**：[ip-api.com](https://ip-api.com/) 免费版（HTTP，限流 45 次/分钟，`lang=zh` 返回中文）

**实现**：[server/tools/weather.ts](file:///d:/code/my-chat/server/tools/weather.ts)（核心函数 `getCityByIp`）

### webSearch

网页搜索工具，仅对支持 `toolCalling` 且非视觉模型注册，可通过 `enable_web_search: false` 关闭。当用户消息包含"最新/今天/近期/当前/现在/最近/新闻/实时/热点/动态"等关键词时，系统提示词会强制 LLM 调用此工具。

**输入**

```ts
{
  query: string
} // 搜索关键词
```

**输出**

```ts
{
  results: Array<{
    index: number,
    title: string,
    url: string,
    snippet: string  // 最多 200 字符
  }>,
  totalResults: number,
  query: string
}
```

**数据源**：[Tavily API](https://tavily.com/)，需在 `.env` 中配置 `TAVILY_API_KEY`

### extractTextFromImage（OCR 工具）

文档识别工具，调用 `PaddlePaddle/PaddleOCR-VL-1.5` 模型提取图片中的文字并以 Markdown 格式返回。仅对支持 `toolCalling` 的模型注册，可通过 `enable_ocr: false` 关闭（默认关闭）。系统提示词会引导 LLM 在用户上传图片且明确要求「提取文字 / OCR / 识别表格 / 文档结构化 / 印章 / 手写 / 扫描件 / 发票 / 合同 / 表单」等场景时调用，通用图像理解（"图中是什么"、"描述图片"）场景不调用。

**输入**

```ts
{
  imageUrl: string  // 图片的公开 URL（仅支持 https + 白名单域名）
}
```

**URL 白名单**（SSRF 防护）

- 协议：仅 `https:`（拒绝 `http:` / `file:` 等）
- 域名：`i.ibb.co`（项目主用）、`i.imgur.com`、`cdn.discordapp.com`、`pbs.twimg.com`、`*.alicdn.com`、`*.qpic.cn`、`*.weixin.qq.com`
- 内网 IP 黑名单：DNS 解析后检查 RFC 1918（10/8、172.16/12、192.168/16）、link-local（169.254/16，含云元数据 169.254.169.254）、loopback（127/8）、IPv6 ULA
- 重定向策略：`redirect: 'manual'`，拒绝任何 3xx 响应
- 大小限制：10MB

**输出**（成功）

```ts
{
  text: string,       // Markdown 格式的识别结果
  imageUrl: string,   // 原始图片 URL
  model: 'PaddlePaddle/PaddleOCR-VL-1.5'
}
```

**输出**（失败，不抛异常，返回错误对象由 LLM 决定后续动作）

```ts
{
  error: string,      // 错误概要：'URL 安全检查失败' | '图片下载失败' | 'OCR 服务调用失败' | 'OCR 处理失败'
  detail: string,     // 错误详情
  imageUrl: string
}
```

**调用约束**

- PaddleOCR-VL-1.5 不支持 `enable_thinking` 参数，请求体中**不传**该字段
- 单次仅处理 1 张图片，LLM 对多图场景需分别调用
- Authorization 复用 `OPENAI_API_KEY`，baseURL 复用 `OPENAI_BASE_URL`
- 请求超时 30 秒（`AbortController`）

**实现**：[server/tools/ocr-document.ts](file:///d:/code/codeWork/my-chat/server/tools/ocr-document.ts)

---

## 环境变量

| 变量名            | 必填 | 说明                                                 |
| ----------------- | ---- | ---------------------------------------------------- |
| `OPENAI_API_KEY`  | 是   | LLM Provider API Key（硅基流动）                     |
| `OPENAI_BASE_URL` | 否   | LLM API 基地址，默认 `https://api.siliconflow.cn/v1` |
| `LLM_MODEL`       | 否   | 默认模型，默认 `Qwen/Qwen3-8B`                       |
| `ENABLE_THINKING` | 否   | 默认是否启用思考，默认 `true`（设为 `false` 关闭）   |
| `SYSTEM_PROMPT`   | 否   | 自定义系统提示词                                     |
| `IMGBB_API_KEY`   | 否   | ImgBB 图床 API Key，启用图片对话必填                 |
| `TAVILY_API_KEY`  | 否   | Tavily 搜索 API Key，启用网页搜索必填                |
| `DATABASE_URL`    | 是   | PostgreSQL 连接串，开发端口 5434                     |

---

## 部署备注：IP 透传信任链

`getCityByIp` 工具依赖 `chat.post.ts` 的 `getClientIp(event)` 读取客户端真实 IP 注入到 system prompt。生产部署必须正确配置反向代理的 `X-Forwarded-For` 信任链，否则 LLM 会拿到错误的 IP（如代理服务器自身 IP），导致天气查询结果不准确。

**Vercel / Cloudflare 等 Serverless 平台**：默认支持，无需额外配置。

**自建 Nginx**（appending 模式）：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

> ⚠️ **安全提示**：当前 `getClientIp` 取 `x-forwarded-for` 第一个非内网 IP，适配覆盖式代理（Vercel/Cloudflare）。在自建 Nginx appending 模式下，攻击者可伪造 `X-Forwarded-For: fake_ip, real_ip` 头部绕过非内网过滤，**最坏影响仅限天气查询结果不准确**，非安全风险。若未来 IP 定位用于敏感场景，需改为从右向左取第一个受信任的 IP（参考代理信任链配置）。

---

## 相关文件

| 文件                                                                                             | 职责                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| [server/api/chat.post.ts](file:///d:/code/my-chat/server/api/chat.post.ts)                       | AI 对话流式接口                                  |
| [server/api/sessions.ts](file:///d:/code/my-chat/server/api/sessions.ts)                         | 会话列表 GET/POST                                |
| [server/api/sessions/[id].ts](file:///d:/code/my-chat/server/api/sessions/[id].ts)               | 单会话 GET/PATCH/DELETE                          |
| [server/api/models.ts](file:///d:/code/my-chat/server/api/models.ts)                             | 模型列表 GET                                     |
| [server/middleware/security.ts](file:///d:/code/my-chat/server/middleware/security.ts)           | CSP/限流/CORS/UUID 校验                          |
| [server/config/models.ts](file:///d:/code/my-chat/server/config/models.ts)                       | 模型白名单与能力定义                             |
| [server/tools/web-search.ts](file:///d:/code/my-chat/server/tools/web-search.ts)                 | Tavily 网页搜索工具                              |
| [server/tools/ocr-document.ts](file:///d:/code/my-chat/server/tools/ocr-document.ts)             | PaddleOCR-VL-1.5 OCR 文档识别工具                |
| [server/tools/weather.ts](file:///d:/code/my-chat/server/tools/weather.ts)                       | Open-Meteo 天气查询核心函数                      |
| [server/mcp/weather-server.ts](file:///d:/code/my-chat/server/mcp/weather-server.ts)             | MCP Weather Server（stdio）                      |
| [server/utils/imgbb.ts](file:///d:/code/my-chat/server/utils/imgbb.ts)                           | ImgBB 图床上传                                   |
| [server/utils/reasoning-provider.ts](file:///d:/code/my-chat/server/utils/reasoning-provider.ts) | 自定义 OpenAI Provider（reasoning_content 拦截） |
| [docs/db-schema.md](file:///d:/code/my-chat/docs/db-schema.md)                                   | 数据库表结构文档                                 |
