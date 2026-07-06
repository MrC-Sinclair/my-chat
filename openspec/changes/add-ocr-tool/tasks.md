# Tasks: add-ocr-tool

> 实现 PaddleOCR-VL-1.5 作为通用对话模型可调用的 OCR 工具
> 关联决策：design.md Decision 1-9 + spec.md Requirements

## 1. OCR 工具定义（server/tools/ocr-document.ts）

- [ ] 1.1 新建 `server/tools/ocr-document.ts` 文件
- [ ] 1.2 定义 `OCR_INSTRUCTION` 常量：包含「提取图片中的文字、Markdown 输出、表格语法、印章标记、公式 LaTeX 包裹、保持版面结构」等指令
- [ ] 1.3 实现 `callPaddleOCR(imageBase64: string)` 内部函数：用 **Node 20+ 全局 `fetch`**（与 web-search.ts 一致，**不要用 https 模块**）调用 `https://api.siliconflow.cn/v1/chat/completions`，model 为 `PaddlePaddle/PaddleOCR-VL-1.5`，Authorization 复用 `process.env.OPENAI_API_KEY`，baseURL 复用 `process.env.OPENAI_BASE_URL`（与 [reasoning-provider.ts#L183-L184](file:///d:/code/codeWork/my-chat/server/utils/reasoning-provider.ts#L183-L184) 一致），**不传 `enable_thinking` 参数**，用 `AbortController` 设置 30 秒超时
- [ ] 1.4 实现 `downloadImageAsBase64(url: string)` 内部函数：先 `validateImageUrl()` 走 SSRF 防护（详见 task 1.11），再 `fetch(url, { redirect: 'manual' })` → buffer → `data:${contentType};base64,...`，手动处理 3xx 重定向（拒绝任何重定向，防止重定向到内网）
- [ ] 1.5 用 `tool()` 定义 `ocrDocumentTool`，name 为 `extractTextFromImage`，description 明确「仅在用户上传图片且需要 OCR 时调用，无图片时禁止调用，不要在通用图像理解时调用」
- [ ] 1.6 `inputSchema` 用 `z.object({ imageUrl: z.string().url().describe('图片的公开 URL（仅支持 i.ibb.co 等白名单域名）') })`
- [ ] 1.7 `execute` 函数：调用 `validateImageUrl` → `downloadImageAsBase64` → `callPaddleOCR` → 返回 `{ text: markdownText, imageUrl, model: 'PaddlePaddle/PaddleOCR-VL-1.5' }`
- [ ] 1.8 错误处理（**与 web-search 模式一致，不抛异常**）：
  - URL 验证失败：返回 `{ error: 'URL 安全检查失败', detail: reason, imageUrl }`
  - 图片下载失败：返回 `{ error: '图片下载失败', detail: statusCode, imageUrl }`
  - 重定向：返回 `{ error: '禁止自动重定向（防 SSRF）', imageUrl }`
  - 图片过大：返回 `{ error: '图片过大，超过 10MB 上限', imageUrl }`
  - PaddleOCR API 失败：返回 `{ error: 'OCR 服务调用失败', detail, imageUrl }`
  - 全部包在 try/catch 中，捕获后转为错误对象
- [ ] 1.9 新增 `validateImageUrl(url)` 内部函数：实现 **Decision 9 SSRF 三重防护**：
  - 协议白名单：`https:` 之外拒绝
  - 域名白名单：`i.ibb.co`（项目主用）、`i.imgur.com`、`cdn.discordapp.com`、`pbs.twimg.com`、`*.alicdn.com`、`*.qpic.cn`、`*.weixin.qq.com`
  - 内网 IP 黑名单：`dns.lookup(hostname)` 后检查 RFC 1918 + link-local + IPv6 ULA
  - `redirect: 'manual'` 拒绝自动重定向
  - 10MB 大小限制
- [ ] 1.10 `import dns from 'node:dns/promises'`
- [ ] 1.11 运行 `pnpm typecheck` 验证类型
- [ ] 1.12 运行 `pnpm lint` 验证代码风格

## 2. 服务端注册 OCR 工具 + maxSteps 重构 + 图片分流（server/api/chat.post.ts）

- [ ] 2.1 在文件顶部 `import { ocrDocumentTool } from '~/server/tools/ocr-document'`
- [ ] 2.2 在 `readBody` 解构中加入 `enable_ocr`，并用 `const enableOcr = enable_ocr === true` 解析默认值（非 true 一律为 false）
- [ ] 2.3 **重构 maxSteps 逻辑（关键修复）**：将 `toolsConfig` 构建移到 `maxSteps` 计算之前，然后用 `const hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0` + `const stopWhen = stepCountIs(hasActiveTools ? 5 : 1)` 替换原来的 `const maxSteps = caps.vision || caps.deepThinking ? 1 : 5`
- [ ] 2.4 在 `toolsConfig` 中调整 webSearchTool 注册条件：`...(webSearchEnabled && caps.toolCalling && { webSearch: webSearchTool })`（**建议**增加 caps.toolCalling 守卫，属防御性深度措施：当前 [chat.post.ts#L285-L288](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L285-L288) 中 `tools` 参数仅在 `caps.toolCalling` 为 true 时才传给 `streamText`，不加守卫工具也不会被执行，但显式守卫更清晰）
- [ ] 2.5 在 `toolsConfig` 中扩展 OCR 工具：`...(enableOcr && caps.toolCalling && { extractTextFromImage: ocrDocumentTool })`
- [ ] 2.6 **修复 webSearch prompt 注入条件**：将 `if (webSearchEnabled && !caps.vision && caps.toolCalling)` 改为 `if (webSearchEnabled && caps.toolCalling)`（视觉模型启用工具后也允许 web 搜索提示词注入；**注意前端按钮 v-if 保持 `!caps.vision` 不变**，是产品决策）
- [ ] 2.7 在 `finalSystemPrompt` 构建处新增 OCR 规则追加逻辑：`if (enableOcr && caps.toolCalling) { finalSystemPrompt += OCR_TOOL_RULES }`
- [ ] 2.8 定义 `OCR_TOOL_RULES` 常量：包含正向场景（提取文字/OCR/识别/表格转 Markdown/文档结构化/印章/签名/手写/扫描件/发票/合同/表单）、**关键指令**「当用户消息中包含 `[附图片N: URL]` 格式的文本时，表示用户上传了图片（你无法直接看到图片内容），你应该使用 `extractTextFromImage` 工具提取图片中的文字」（非视觉模型专属）、负向场景（通用图像理解/图中是什么/描述图片/未上传图片/普通照片/人物/风景）、「无图片时禁止调用」、「禁止重复调用同一图片」（防 maxSteps=5 下死循环）
- [ ] 2.9 **非视觉模型图片分流（关键修复）**：重构 line 198-216 逻辑：
  ```typescript
  const parts: any[] = [{ type: 'text', text: lastUserMessage.content }]
  if (caps.vision && imageUrls.length > 0) {
    // 视觉模型：图片作为多模态 parts
    for (const url of imageUrls) {
      if (url.startsWith('data:')) {
        // ImgBB 失败降级：复用 parseBase64Meta
        const { base64, mimeType } = parseBase64Meta(url)
        parts.push({ type: 'image', image: base64, mimeType })
      } else {
        parts.push({ type: 'image', image: new URL(url) })
      }
    }
  } else if (!caps.vision && imageUrls.length > 0) {
    // 非视觉模型：图片 URL 文本注入（过滤掉 data: 降级值）
    const publicUrls = imageUrls.filter(u => !u.startsWith('data:'))
    const dataUrls = imageUrls.filter(u => u.startsWith('data:'))
    publicUrls.forEach((url, i) => {
      parts[0].text += `\n\n[附图片${i + 1}: ${url}]`
    })
    if (dataUrls.length > 0) {
      parts[0].text += `\n\n[提示：${dataUrls.length} 张图片上传失败，OCR 不可用，请重新上传]`
    }
  }
  ```
- [ ] 2.10 验证防御性兜底：OCR toggle 开启但 `caps.toolCalling=false` 时不注册工具（即使 `enableOcr=true && caps.toolCalling=false`，也不注册）
- [ ] 2.11 运行 `pnpm typecheck` 验证类型
- [ ] 2.12 运行 `pnpm lint` 验证代码风格

## 3. useChatConfig 扩展（composables/useChatConfig.ts）

- [ ] 3.1 新增 `const enableOcr = ref(false)`
- [ ] 3.2 新增 `const currentSupportsOcr = computed(() => currentCapabilities.value.toolCalling)`
- [ ] 3.3 扩展 `watch(currentModel, ...)`：切换到 `toolCalling=false` 模型时自动 `enableOcr.value = false`
- [ ] 3.4 在返回对象中加入 `enableOcr` 与 `currentSupportsOcr`
- [ ] 3.5 **补全 FALLBACK_MODELS**：在数组中新增 Qwen3.5-4B 配置（与 [server/config/models.ts#L43-L48](file:///d:/code/codeWork/my-chat/server/config/models.ts#L43-L48) **完全一致**）：
  ```typescript
  {
    label: 'Qwen3.5-4B',
    value: 'Qwen/Qwen3.5-4B',  // 注意是 . 不是 -
    capabilities: { vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true }
  }
  ```
- [ ] 3.6 运行 `pnpm typecheck` 验证 computed 类型推断正确
- [ ] 3.7 运行 `pnpm lint` 验证代码风格

## 4. ChatInput OCR toggle 按钮 + 图片上传联动（components/chat/ChatInput.vue）

- [ ] 4.1 在 `defineProps` 中新增 `enableOcr: { type: Boolean, required: true }` 与 `supportsOcr: { type: Boolean, required: true }`
- [ ] 4.2 在 `defineEmits` 中新增 `'update:enableOcr': [value: boolean]`
- [ ] 4.3 新增 `const canUploadImage = computed(() => supportsVision || enableOcr)`
- [ ] 4.4 在「联网」按钮后新增 OCR toggle 按钮，`v-if="supportsOcr"`
- [ ] 4.5 按钮样式与「联网」按钮一致：`min-h-[32px]`、`active:scale-95`、`bg-semi-primary-light text-semi-primary`（开启时）或 `bg-semi-fill-0 text-semi-text-2`（关闭时）
- [ ] 4.6 按钮 SVG 图标：使用文档+放大镜图标（参考"扫描文档"主题）
- [ ] 4.7 按钮文案：「OCR」
- [ ] 4.8 `v-tooltip` 文案：`enableOcr ? '智能 OCR 已开启' : '智能 OCR 已关闭'`
- [ ] 4.9 `@click="emit('update:enableOcr', !enableOcr)"`
- [ ] 4.10 **修改图片上传按钮**：
  - `<label>` 的 `class` 改为 `canUploadImage ? 'text-semi-text-3 hover:text-semi-text-2 cursor-pointer' : 'text-semi-border cursor-not-allowed'`
  - `<label>` 的 `v-tooltip` 改为 `canUploadImage ? '添加图片' : '当前模型不支持图片，请先开启 OCR 工具'`
  - `<input type="file">` 的 `:disabled` 改为 `!canUploadImage || images.length >= MAX_IMAGES`
- [ ] 4.11 运行 `pnpm typecheck` 验证 props 类型
- [ ] 4.12 运行 `pnpm lint` 验证模板与脚本无 lint 错误

## 5. ai-chat.vue 透传（pages/ai-chat.vue）

- [ ] 5.1 从 `useChatConfig()` 解构 `enableOcr` 与 `currentSupportsOcr`
- [ ] 5.2 在 `<ChatInput>` 调用处透传 `:enable-ocr="enableOcr"` 与 `:supports-ocr="currentSupportsOcr"`
- [ ] 5.3 在 `<ChatInput>` 监听 `@update:enable-ocr="enableOcr = $event"`
- [ ] 5.4 **在 `useChat` 的 `body` 箭头函数中新增 `enable_ocr: enableOcr.value`**（注意：当前代码是 `body: () => ({...})` 函数式，不是 `computed()`，AI SDK v5 DefaultChatTransport 接受函数式 body，每次请求重新调用以拿最新值。AGENTS.md 提到的 "computed 包裹" 是 v4 时代的写法）
- [ ] 5.5 运行 `pnpm typecheck` 验证 props 透传无类型错误
- [ ] 5.6 运行 `pnpm lint` 验证代码风格

## 6. ToolInvocation 组件新增 OCR 工具分支（components/chat/ToolInvocation.vue）

> ⚠️ **关键任务**：当前组件**只有 `weather` 和 `webSearch` 两个 v-if 分支**，不实现会 OCR 工具调用时 UI 空白

- [ ] 6.1 在 `<script setup>` 中新增 `getInputImageUrl(input: Record<string, unknown>): string` 函数，从 input 中读取 `imageUrl` 字段
- [ ] 6.2 在 `<script setup>` 中新增 `OcrResult` 类型：`{ text?: string; error?: string; detail?: string; imageUrl?: string }`
- [ ] 6.3 在模板中现有 `weather` 和 `webSearch` 分支**之后**新增 `extractTextFromImage` 分支（参考 `webSearch` 分支的结构）
- [ ] 6.4 **加载中状态**：`v-if="isCalling(invocation.state)"` 显示"正在识别图片中的文字..." + 脉冲点动画（与 weather 加载样式一致：紫色光晕 + 文字）。`isCalling` 判定 `input-streaming` 或 `input-available` 都算 loading（[ToolInvocation.vue#L48-L50](file:///d:/code/codeWork/my-chat/components/chat/ToolInvocation.vue#L48-L50)），所以在 input 传完到 output 返回之间的一小段时间也会显示 loading，行为正确
- [ ] 6.5 **结果展示状态**：`v-else-if="invocation.state === 'output-available' && invocation.output"` 渲染结果卡片：
  - 头部：图标 + "OCR 识别完成" 标签 + 折叠/展开按钮
  - 图片缩略图：`<img :src="getInputImageUrl(invocation.input)" class="w-12 h-12 object-cover rounded border">`（48x48 圆角）
  - Markdown 预览：`{{ (output as OcrResult).text?.slice(0, 200) }}`（前 200 字符 + "..."）
  - 复制按钮：与 webSearch 一致
- [ ] 6.6 **错误状态**：`v-else-if="(output as OcrResult).error"` 渲染错误卡片（红色边框 + 错误图标 + `(output as OcrResult).error` 文本 + `detail` 详情）
- [ ] 6.7 运行 `pnpm typecheck` 验证类型
- [ ] 6.8 运行 `pnpm lint` 验证代码风格

## 7. ai-chat.vue 工具调用事件归一化验证（pages/ai-chat.vue）

- [ ] 7.1 阅读 [ai-chat.vue#L313-L327](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue#L313-L327) 的 `getToolInvocations`，确认 `tool-extractTextFromImage` 静态工具 part type 能被正确归一化为 `toolName: 'extractTextFromImage'`（当前逻辑 `p.type.startsWith('tool-')` → `p.type.slice(5)` 已覆盖，无需修改）
- [ ] 7.2 **在 `getVisibleToolInvocations` 中新增 OCR 过滤**（[ai-chat.vue#L334-L339](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue#L334-L339)）：将 `if (enableWebSearch.value) return all` 改为逐个过滤模式，新增 `if (inv.toolName === 'extractTextFromImage' && !enableOcr.value) return false`
- [ ] 7.3 运行 `pnpm typecheck` 验证
- [ ] 7.4 运行 `pnpm lint` 验证

## 8. 单元测试

- [ ] 8.1 新增 `tests/unit/ocr-document.test.ts`：
  - mock `fetch` 验证合法 ImgBB URL 走通完整流程（图片下载 → base64 → PaddleOCR API → 返回 Markdown）
  - 验证 HTTP 协议 URL 被 SSRF 防护拒绝
  - 验证 `evil.com` 等非白名单域名被拒绝
  - 验证 `localhost` 等内网域名被 `dns.lookup` 解析后拒绝
  - 验证图片下载重定向被拒绝
  - 验证 PaddleOCR API 失败返回错误对象
  - 验证 `enable_thinking` 参数未传
  - 验证请求超时（30s AbortController）
- [ ] 8.2 新增 ChatInput 渲染单测：
  - `toolCalling=true` 时 OCR 按钮可见
  - `toolCalling=false` 时 OCR 按钮不渲染
  - 点击按钮触发 `update:enableOcr` 事件
  - OCR 按钮开启时高亮样式 + tooltip 文案变化
  - 视觉模型图片上传按钮始终可见
  - 非视觉模型 + OCR 开启时图片上传按钮可见
  - 非视觉模型 + OCR 关闭时图片上传按钮隐藏 + tooltip 提示开启 OCR
- [ ] 8.3 新增 `chat.post.ts` 单测：
  - `enable_ocr=true && toolCalling=true` 时 `toolsConfig` 包含 `extractTextFromImage`
  - `enable_ocr=false` 时不包含
  - `toolCalling=false` 时不包含
  - 有工具注册时 `hasActiveTools=true`、`stopWhen=stepCountIs(5)`
  - 无工具注册时 `hasActiveTools=false`、`stopWhen=stepCountIs(1)`
  - 视觉模型 + 有图片时 parts 包含 `{ type: 'image' }`
  - 非视觉模型 + OCR 开启 + 有图片时 parts 仅含 text（URL 注入到文本末尾）
  - 非视觉模型 + OCR 开启 + ImgBB 失败（dataURL）时注入降级提示
- [ ] 8.4 新增 useChatConfig 单测：
  - 切换到 toolCalling=false 模型时 `enableOcr` 自动设为 false
  - 切换到 toolCalling=true 模型时 `enableOcr` 保持不变
- [ ] 8.5 运行 `pnpm test:unit` 验证全部单元测试通过
- [ ] 8.6 运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证 Markdown 渲染管线无回归

## 9. E2E 测试

- [ ] 9.1 新增 `tests/e2e/ocr-tool.spec.ts`：
  - mock PaddleOCR API 返回 Markdown 表格
  - 选 `Qwen3-8B`（vision=false）→ 开启 OCR → 上传图片（此时上传按钮应可见）→ 输入「提取文字」→ 看到 ToolInvocation 显示「正在识别...」 → 看到 Markdown 表格渲染
- [ ] 9.2 E2E 验证：选 `Qwen/Qwen3.5-4B`（vision=true）→ OCR 按钮可见 → 上传图片始终可用
- [ ] 9.3 E2E 验证：选 `THUDM/GLM-Z1-9B-0414`（toolCalling=false）时 OCR 按钮不渲染
- [ ] 9.4 E2E 验证：选 `Qwen3-8B` + OCR 关闭时，图片上传按钮不可见（cursor-not-allowed + tooltip 提示）
- [ ] 9.5 E2E 验证：从 `Qwen3-8B`（开启 OCR）切换到 `GLM-Z1`，OCR toggle 自动关闭
- [ ] 9.6 E2E 验证：OCR 开启但用户纯文本对话（无图片），LLM 不调用 OCR 工具
- [ ] 9.7 E2E mock 流式输出：
  - `tool-input-available` 事件包含 `imageUrl` 字段
  - `tool-output-available` 事件包含 Markdown 文本
  - ToolInvocation 组件正确切换状态（loading → result）
- [ ] 9.8 E2E 验证：reasoning 与工具调用事件正常交织（Qwen3.5-4B 启用 OCR 时的 thinking + tool call 序列）
- [ ] 9.9 运行 `pnpm test:e2e` 验证全部 E2E 测试通过

## 10. 文档同步

- [ ] 10.1 更新 `docs/API.md`：在请求 body 字段表中新增 `enable_ocr` 字段说明（类型 boolean，默认 false，仅 toolCalling 模型生效）
- [ ] 10.2 在 `docs/API.md` 工具列表中新增 `extractTextFromImage` 工具说明（参数 `imageUrl`、返回值结构 `{ text, imageUrl, model }`、错误返回 `{ error, detail, imageUrl }`、调用场景）
- [ ] 10.3 在 `docs/模型.md` 的 PaddleOCR 行补充说明：「作为 OCR 工具被通用对话模型调用，不在模型选择器中暴露；通过 LLM 工具调用方式触发，仅 `Qwen3-8B` / `Qwen3.5-4B` 可调用」

## 11. 集成验证（参考 AGENTS.md 验证纪律）

- [ ] 11.1 启动 `pnpm dev`，切换到 `Qwen3-8B` 模型
- [ ] 11.2 验证 OCR toggle 按钮在「联网」按钮后面显示，默认关闭
- [ ] 11.3 验证 `Qwen3-8B` + OCR 关闭时图片上传按钮不可见（cursor-not-allowed）
- [ ] 11.4 点击 OCR toggle 按钮，验证高亮 + tooltip 变化 + 图片上传按钮出现
- [ ] 11.5 上传图片 + 输入「提取文字」+ 发送，验证 LLM 调用 OCR 工具（ToolInvocation 组件显示 loading 状态）
- [ ] 11.6 验证 ToolInvocation 组件正确显示 OCR 结果（图片缩略图 + Markdown 预览）
- [ ] 11.7 验证最终输出包含 Markdown 表格/标题/印章标记，渲染正常
- [ ] 11.8 切换到 `Qwen/Qwen3.5-4B`，验证图片上传按钮始终可见、OCR 按钮可见
- [ ] 11.9 切换到 `GLM-Z1-9B-0414` 模型，验证 OCR 按钮隐藏
- [ ] 11.10 切换回 `Qwen3-8B`，验证 OCR toggle 自动关闭（之前开启的状态不保留）
- [ ] 11.11 纯文本对话（无图片），验证 LLM 不调用 OCR 工具
- [ ] 11.12 **验证流式输出正常**：OCR 工具调用场景下打字机效果不被破坏（参考 AGENTS.md 注意事项：`/api/chat` SSE 流不被 nuxt.config.ts 中间件缓冲）
- [ ] 11.13 验证 Qwen3-8B 开启「联网搜索」也正常（之前 maxSteps=1 阻断的工具调用现应恢复）
- [ ] 11.14 运行 `pnpm typecheck && pnpm lint && pnpm test:unit` 三件套最终验证

## 12. 安全专项验证

- [ ] 12.1 单元测试覆盖 SSRF 防护（task 8.1 已包含）
- [ ] 12.2 集成测试：尝试让 LLM 调用 `extractTextFromImage({ imageUrl: 'http://localhost:5432/' })`，验证被 SSRF 防护拒绝
- [ ] 12.3 集成测试：尝试让 LLM 调用 `extractTextFromImage({ imageUrl: 'http://169.254.169.254/' })`（云元数据），验证被拒绝
- [ ] 12.4 集成测试：尝试让 LLM 调用 `extractTextFromImage({ imageUrl: 'https://evil.com/payload.png' })`，验证被拒绝
- [ ] 12.5 集成测试：尝试让 LLM 调用 `extractTextFromImage({ imageUrl: 'https://i.ibb.co/xxx/redirect-to-internal' })`（302 重定向到内网），验证被拒绝

## 13. 已知限制（需向用户说明）

- **历史消息图片不传给 LLM**：当前 chat.post.ts 不把历史消息的 `images` 字段作为多模态 parts，OCR 工具的多轮对话中"基于你之前发的图"类问题可能无法正确处理（见 Open Questions Q2）
- **OCR 工具仅支持单图**（首期）：PaddleOCR-VL-1.5 API 单次只处理 1 张图，LLM 可对多图分别调用工具
- **ImgBB 失败时非视觉模型无法 OCR**：dataURL 无法被工具 fetch，注入降级提示用户重传
- **OCR 工具不暴露在模型选择器**：仅作为 LLM 自主调用的工具，前端无法手动触发
- **工具调用增加 2-3 倍延迟**：LLM 判断 + 工具执行 + 二次总结
