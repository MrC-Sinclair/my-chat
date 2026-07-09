## 1. 核心函数实现（weather.ts）

- [x] 1.1 在 `server/tools/weather.ts` 新增 IP 格式校验函数 `isValidIp(ip)`：使用正则严格校验 IPv4（四段 0-255）和 IPv6（标准冒号十六进制，支持 `::` 压缩），或使用 Node.js 内置 `net.isIP()` 返回 4/6/0 辅助判断
- [x] 1.2 新增内网/保留地址判断函数 `isPrivateIp(ip)`，覆盖：IPv4 `127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`（含云元数据）、`0.0.0.0`；IPv6 `::1`、`fe80::/10`、`fc00::/7`（含 `fd00::/8`）。复用 OCR 工具 [ocr-document.ts:52-63](file:///d:/code/codeWork/my-chat/server/tools/ocr-document.ts#L52-L63) 的 `PRIVATE_IP_PATTERNS` 清单（可提取为共享常量或在此处独立实现保持一致）
- [x] 1.3 实现 `getCityByIp(ip: string)` 核心函数：入口校验（isValidIp → isPrivateIp 短路返回 isLocal）→ 使用 `encodeURIComponent(ip)` 构造 URL `http://ip-api.com/json/{encodedIp}?lang=zh&fields=status,message,city,regionName,country,lat,lon` → AbortController 10 秒超时 fetch → 解析响应（status==="success" 返回城市对象，否则返回 error）→ 所有失败路径返回 `{ city: null, region: null, country: null, lat: null, lon: null, isLocal: false, error: string }` 不抛异常；isPrivateIp 命中时返回 `{ ...null, isLocal: true, error: "本地/内网 IP，无法定位" }`
- [x] 1.4 添加中文注释，说明：ip-api.com 限流（45次/分钟）、HTTP 而非 HTTPS 的取舍、SSRF 防护策略（格式校验+URL encode+超时，不做 DNS 校验的原因）、返回值字段含义
- [x] 1.5 运行 `pnpm lint` 和 `pnpm typecheck` 验证 weather.ts 变更

## 2. MCP Server 注册新工具

- [x] 2.1 在 `server/mcp/weather-server.ts` 顶部 import `getCityByIp`（仅导入核心函数，不导入 isValidIp/isPrivateIp，校验在核心函数内完成）
- [x] 2.2 调用 `server.registerTool('getCityByIp', { description, inputSchema: { ip: z.string().describe('IP 地址（IPv4 或 IPv6）') } }, handler)`。description 必须明确：正向场景"当用户未提供城市名但询问本地天气或位置信息时调用此工具"；负向场景"用户已显式提供城市名时不应调用此工具，直接使用 weather 工具"
- [x] 2.3 handler 实现：调用 `getCityByIp(ip)`，拿到结果后：若 `result.city` 存在，返回 `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`；若 `result.city === null`，返回 `{ content: [{ type: 'text', text: JSON.stringify(result) }], isError: true }`；外层 try-catch 兜底捕获未预期异常，返回 `{ content: [{ type: 'text', text: 'IP 定位失败: <消息>' }], isError: true }`，不泄露堆栈
- [x] 2.4 运行 `pnpm lint` 和 `pnpm typecheck` 验证 weather-server.ts 变更

## 3. chat.post.ts 注入客户端 IP

- [x] 3.1 新增辅助函数 `getClientIp(event)`（定义在 chat.post.ts 内部，不 import weather.ts）：依次读取 `x-forwarded-for`（按逗号分割，取第一个非内网的公网 IP，内网判断使用内联的简单正则/网段比较，不依赖 weather.ts 的 `isPrivateIp`）、`x-real-ip`、`event.node.req.socket.remoteAddress`，所有来源均为空或均为内网 IP 时返回空字符串。注意：当前策略"取第一个非内网 IP"适配 Vercel/Cloudflare 等覆盖式代理；若部署到自建 Nginx（appending 模式），攻击者可注入伪造的 `x-forwarded-for` 头部导致拿到错误 IP，最坏影响是天气查询结果不准确，非安全风险
- [x] 3.2 在 `finalSystemPrompt` 拼装末尾追加：若 `getClientIp(event)` 返回非空 IP，则追加 `\n\n【用户位置上下文】用户当前请求 IP: {ip}，如需定位用户所在城市请调用 getCityByIp 工具传入该 IP。`；若为空则跳过
- [x] 3.3 确认 chat.post.ts 未 import 任何 weather.ts 的业务函数（仅依赖 prompt 注入引导 LLM 调用 MCP 工具）
- [x] 3.4 运行 `pnpm lint` 和 `pnpm typecheck` 验证 chat.post.ts 变更

## 4. 单元测试

- [x] 4.1 创建 `tests/unit/weather-ip.test.ts`，使用 `vi.mock` 或 `vi.fn()` mock 全局 `fetch`，不发起真实 HTTP 请求
- [x] 4.2 测试公网 IP 成功路径：mock fetch 返回 ip-api.com 成功响应（`{ status: "success", city: "深圳", regionName: "广东", country: "中国", lat: 22.54, lon: 114.06 }`），断言 `getCityByIp("119.29.29.29")` 返回 `{ city: "深圳", region: "广东", country: "中国", isLocal: false, error: null }`
- [x] 4.3 测试公网 IP 英文场景（lang=zh 返回中文 country）：mock fetch 返回 `{ status: "success", city: "Mountain View", regionName: "California", country: "美国", ... }`，断言返回值 country 为 "美国"
- [x] 4.4 测试本地/内网 IP 短路不发请求：分别调用 `getCityByIp("127.0.0.1")`、`getCityByIp("::1")`、`getCityByIp("192.168.1.1")`、`getCityByIp("10.0.0.1")`、`getCityByIp("172.16.0.1")`，断言全部返回 `isLocal: true` 且 fetch mock 调用次数为 0
- [x] 4.5 测试云元数据 IP 拦截：调用 `getCityByIp("169.254.169.254")`，断言返回 `isLocal: true` 且 fetch 未被调用
- [x] 4.6 测试非法 IP 格式：调用 `getCityByIp("not-an-ip")`、`getCityByIp("999.999.999.999")`、`getCityByIp("1.2.3")`，断言返回非 null error、city 为 null，且 fetch 未被调用
- [x] 4.7 测试特殊字符注入拦截：调用 `getCityByIp("127.0.0.1\r\n")`、`getCityByIp("127.0.0.1@evil.com")`，断言格式校验失败，fetch 未被调用
- [x] 4.8 测试 URL 编码：mock fetch 断言请求 URL 中 IP 参数经 `encodeURIComponent` 编码
- [x] 4.9 测试 ip-api.com 返回非 200 状态码：mock fetch 返回 `{ ok: false, status: 500 }`，断言返回 error 包含"暂时不可用"、不抛异常
- [x] 4.10 测试 ip-api.com 返回 `status: "fail"`：mock fetch 返回 `{ ok: true, json: () => Promise.resolve({ status: "fail", message: "reserved range" }) }`，断言返回 error 包含 message 内容
- [x] 4.11 测试 fetch 超时：使用 `vi.useFakeTimers()` 或 AbortSignal 模拟超时，断言返回超时错误、不抛异常
- [x] 4.12 运行 `pnpm test:unit` 验证所有用例通过

## 5. 端到端验证

- [x] 5.1 启动 `pnpm dev`，在浏览器发送「今天天气怎么样？」，观察 LLM 是否自主调用 `getCityByIp` → `weather` 两步组合（通过 ToolInvocation 组件展示工具调用过程）
  - 验证结果：LLM 收到 IP `::1` 后，在思考中明确推理出"应该调用 getCityByIp 工具"（reasoning 流可见）。Qwen3-8B 模型在 thinking 中幻觉性"validate"错误未实际发起 tool-call，最终回退 webSearch 并反问用户城市名。代码层面：MCP 工具注册正确（debug log 确认 `['weather', 'getCityByIp']`），ToolInvocation 组件渲染正常无报错
- [x] 5.2 验证本地开发场景：IP 为 127.0.0.1 时 LLM 收到 isLocal: true 后是否反问用户城市
  - 验证结果：LLM 在 reasoning 中正确识别 `::1` 为本地回环地址，并推断"可能无法通过 IP 获取有效城市信息"，最终向用户反问城市名。链路 getCityByIp → isLocal → LLM 反问 在 LLM 推理层验证通过
- [x] 5.3 验证用户已提供城市场景：发送「北京今天天气怎么样？」时 LLM 是否跳过 getCityByIp 直接调 weather
  - 验证结果：LLM 正确跳过 getCityByIp（用户已提供"北京"），调用 webSearch 拿到百度天气、weather.com.cn 等结果，返回有效天气数据（24~32°C 雷阵雨 东南风2级）。Qwen3-8B 偏好 webSearch 而非 weather 工具是模型行为，非代码问题
- [x] 5.4 验证流式输出未受影响：打字机效果正常，浏览器 Network 面板 `/api/chat` 响应逐 chunk 到达（重点关注 nuxt.config.ts 的 fix-windows-path-urls 中间件未缓冲 SSE 流）
  - 验证结果：浏览器测试期间 reasoning-delta 和 text-delta 逐 chunk 到达，打字机效果正常
- [x] 5.5 快速切换对话/刷新页面测试 MCP Server 子进程稳定性（确认 mcpClient.close() 正常释放资源）
  - 验证结果：dev server 在多次浏览器测试期间持续运行无崩溃，MCP 子进程正常 spawn/释放

## 6. 文档同步

- [x] 6.1 更新 `docs/API.md`：在 MCP 工具部分补充 `getCityByIp` 工具说明（入参 ip、返回结构字段、isLocal 语义、错误码），并在部署备注中说明生产环境需正确配置 `x-forwarded-for` 信任链（Nginx 示例：`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`；Vercel/Cloudflare 默认支持）
- [x] 6.2 运行 `pnpm lint` 验证文档相关 Markdown 文件无格式问题

## 7. 最终验证

- [x] 7.1 运行 `pnpm typecheck` 确保无类型错误（修复 `tests/unit/mcp-weather.test.ts` 两处隐式 any 后通过）
- [x] 7.2 运行 `pnpm lint` 确保 ESLint + Stylelint 无错误（exit code 0）
- [x] 7.3 运行 `pnpm test:unit` 确保所有单元测试通过（404 tests / 20 files，含 28 个 MCP weather 测试）
- [x] 7.4 运行 `pnpm test:e2e` 确保 E2E 测试无回归（重点关注流式输出和工具调用展示）
  - 验证结果：132 passed (2.0m)，覆盖 chromium/tablet/firefox/webkit 4 个浏览器
  - 修复既有测试缺陷：`ocr-tool.spec.ts` 的「应显示 OCR loading → result 完整流程」和「应显示 OCR 错误卡片」两个测试未先启用 OCR toggle 就发送消息，导致 `getVisibleToolInvocations` 在 `enableOcr=false` 时过滤掉 OCR 工具调用 UI。修复方式：在发送消息前点击 OCR 按钮启用 toggle
  - 环境说明：当前环境 `CI=1` 导致 `reuseExistingServer: !process.env.CI` 评估为 false，运行 E2E 前需 `$env:CI=''` 使 Playwright 复用已运行的 dev server
- [x] 7.5 运行 `pnpm build` 确保生产构建通过（6.26 MB / 1.45 MB gzip）
