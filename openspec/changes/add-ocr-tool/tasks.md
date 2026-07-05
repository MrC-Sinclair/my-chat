## 1. OCR 工具定义（server/tools/ocr-document.ts）

- [ ] 1.1 新建 `server/tools/ocr-document.ts` 文件
- [ ] 1.2 定义 `OCR_INSTRUCTION` 常量：包含「提取图片中的文字、Markdown 输出、表格语法、印章标记、公式 LaTeX 包裹、保持版面结构」等指令
- [ ] 1.3 实现 `callPaddleOCR(imageBase64: string)` 内部函数：用 `https` 模块调用硅基流动 `PaddlePaddle/PaddleOCR-VL-1.5` 模型，messages 含 OCR_INSTRUCTION + image_url，不传 `enable_thinking` 参数
- [ ] 1.4 实现 `downloadImageAsBase64(url: string)` 内部函数：fetch URL → buffer → base64 data URL，处理 301/302 重定向，处理非 200 状态码
- [ ] 1.5 用 `tool()` 定义 `ocrDocumentTool`，name 为 `extractTextFromImage`，description 明确「仅在用户上传图片且需要 OCR 时调用，无图片时禁止调用」
- [ ] 1.6 `inputSchema` 用 `z.object({ imageUrl: z.string().url().describe('图片的公开 URL') })`
- [ ] 1.7 `execute` 函数：调用 `downloadImageAsBase64` → `callPaddleOCR` → 返回 Markdown 文本
- [ ] 1.8 错误处理：图片下载失败返回 `{ error: '图片下载失败', detail, imageUrl }`；PaddleOCR API 失败返回 `{ error: 'OCR 服务调用失败', detail, imageUrl }`；不抛异常
- [ ] 1.9 运行 `pnpm typecheck` 验证类型
- [ ] 1.10 运行 `pnpm lint` 验证代码风格

## 2. 服务端注册 OCR 工具 + maxSteps 重构（server/api/chat.post.ts）

- [ ] 2.1 在文件顶部 `import { ocrDocumentTool } from '~/server/tools/ocr-document'`
- [ ] 2.2 在 `readBody` 解构中加入 `enable_ocr`，并用 `const enableOcr = enable_ocr === true` 解析默认值（非 true 一律为 false）
- [ ] 2.3 **重构 maxSteps 逻辑**：将 `toolsConfig` 构建移到 `maxSteps` 计算之前，然后用 `const hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0` + `const maxSteps = hasActiveTools ? 5 : 1` 替换原来的 `caps.vision || caps.deepThinking ? 1 : 5`
- [ ] 2.4 在 `toolsConfig` 中调整 webSearchTool 注册条件：`...(webSearchEnabled && caps.toolCalling && { webSearch: webSearchTool })`（增加 caps.toolCalling 守卫）
- [ ] 2.5 在 `toolsConfig` 中扩展 OCR 工具：`...(enableOcr && caps.toolCalling && { extractTextFromImage: ocrDocumentTool })`
- [ ] 2.6 **修复 webSearch prompt 注入条件**：将 `if (webSearchEnabled && !caps.vision && caps.toolCalling)` 改为 `if (webSearchEnabled && caps.toolCalling)`（视觉模型启用工具后也允许 web 搜索提示）
- [ ] 2.7 在 `finalSystemPrompt` 构建处新增 OCR 规则追加逻辑：`if (enableOcr && caps.toolCalling) { finalSystemPrompt += OCR_TOOL_RULES }`
- [ ] 2.8 定义 `OCR_TOOL_RULES` 常量：包含正向场景（提取文字/OCR/识别/表格转 Markdown/文档结构化/印章/签名/手写/扫描件/发票/合同/表单）、负向场景（通用图像理解/图中是什么/描述图片/未上传图片/普通照片/人物/风景）、「无图片时禁止调用」
- [ ] 2.9 **非视觉模型图片 URL 文本注入**：当 `enableOcr && !caps.vision && hasImages` 时，在最后一条用户消息文本末尾追加 `\n\n[附图片{N}: {URL}]` 格式的文本引用，且不为非视觉模型创建 `{ type: 'image' }` content parts（避免 API 报错）
- [ ] 2.10 验证防御性兜底：OCR toggle 开启但 `caps.toolCalling=false` 时不注册工具
- [ ] 2.11 运行 `pnpm typecheck` 验证类型
- [ ] 2.12 运行 `pnpm lint` 验证代码风格

## 3. useChatConfig 扩展（composables/useChatConfig.ts）

- [ ] 3.1 新增 `const enableOcr = ref(false)`
- [ ] 3.2 新增 `const currentSupportsOcr = computed(() => currentCapabilities.value.toolCalling)`
- [ ] 3.3 扩展 `watch(currentModel, ...)`：切换到 `toolCalling=false` 模型时自动 `enableOcr.value = false`
- [ ] 3.4 在返回对象中加入 `enableOcr` 与 `currentSupportsOcr`
- [ ] 3.5 **补全 FALLBACK_MODELS**：在数组中新增 Qwen3.5-4B 配置 `{ label: 'Qwen3.5-4B', value: 'Qwen/Qwen3.5-4B', capabilities: { vision: true, deepThinking: false, toggleableThinking: false, toolCalling: true } }`
- [ ] 3.6 运行 `pnpm typecheck` 验证 computed 类型推断正确
- [ ] 3.7 运行 `pnpm lint` 验证代码风格

## 4. ChatInput OCR toggle 按钮 + 图片上传联动（components/chat/ChatInput.vue）

- [ ] 4.1 在 `defineProps` 中新增 `enableOcr: { type: Boolean, required: true }` 与 `supportsOcr: { type: Boolean, required: true }`
- [ ] 4.2 在 `defineEmits` 中新增 `'update:enableOcr': [value: boolean]`
- [ ] 4.3 在「联网」按钮后新增 OCR toggle 按钮，`v-if="supportsOcr"`
- [ ] 4.4 按钮样式与「联网」按钮一致：`min-h-[32px]`、`active:scale-95`、`bg-semi-primary-light text-semi-primary`（开启时）或 `bg-semi-fill-0 text-semi-text-2`（关闭时）
- [ ] 4.5 按钮 SVG 图标：使用文档/扫描类图标（如文档+放大镜）
- [ ] 4.6 按钮文案：「OCR」
- [ ] 4.7 `v-tooltip` 文案：`enableOcr ? '智能 OCR 已开启' : '智能 OCR 已关闭'`
- [ ] 4.8 `@click="emit('update:enableOcr', !enableOcr)"`
- [ ] 4.9 **修改图片上传按钮显示条件**：从 `v-if="supportsVision"` 改为 `v-if="supportsVision || enableOcr"`，确保非视觉模型在 OCR 开启时也能上传图片
- [ ] 4.10 运行 `pnpm typecheck` 验证 props 类型
- [ ] 4.11 运行 `pnpm lint` 验证模板与脚本无 lint 错误

## 5. ai-chat.vue 透传（pages/ai-chat.vue）

- [ ] 5.1 从 `useChatConfig()` 解构 `enableOcr` 与 `currentSupportsOcr`
- [ ] 5.2 在 `<ChatInput>` 调用处透传 `:enable-ocr="enableOcr"` 与 `:supports-ocr="currentSupportsOcr"`
- [ ] 5.3 在 `<ChatInput>` 监听 `@update:enable-ocr="enableOcr = $event"`
- [ ] 5.4 在 `useChat` 的 `body` computed 中新增 `enable_ocr: enableOcr.value`
- [ ] 5.5 运行 `pnpm typecheck` 验证 props 透传无类型错误
- [ ] 5.6 运行 `pnpm lint` 验证代码风格

## 6. 单元测试

- [ ] 6.1 新增 `tests/unit/ocr-document.test.ts`：mock fetch + PaddleOCR API，验证工具成功返回 Markdown、图片 URL 不可达返回错误对象、PaddleOCR API 失败返回错误对象、不传 enable_thinking 参数
- [ ] 6.2 新增 ChatInput 渲染单测：`toolCalling=true` 时 OCR 按钮可见、`toolCalling=false` 时 OCR 按钮不渲染、点击按钮触发 `update:enableOcr` 事件
- [ ] 6.3 新增 ChatInput 渲染单测：OCR 按钮开启时高亮样式 + tooltip 文案变化
- [ ] 6.4 新增 ChatInput 渲染单测：非视觉模型（vision=false）+ OCR 开启时图片上传按钮可见、非视觉模型 + OCR 关闭时图片上传按钮隐藏
- [ ] 6.5 新增 `chat.post.ts` 单测：`enable_ocr=true && toolCalling=true` 时 toolsConfig 包含 extractTextFromImage、`enable_ocr=false` 时不包含、`toolCalling=false` 时不包含
- [ ] 6.6 新增 `chat.post.ts` 单测：有工具注册时 maxSteps=5（允许工具调用循环），无工具时 maxSteps=1
- [ ] 6.7 新增 `chat.post.ts` 单测：非视觉模型 + OCR 开启 + 有图片时，最后一条用户消息包含 `[附图片N: URL]` 文本引用，且不包含 `{ type: 'image' }` part
- [ ] 6.8 新增 `chat.post.ts` 单测：视觉模型 + 有图片时，使用多模态 parts 传入，不注入文本引用
- [ ] 6.9 运行 `pnpm test:unit` 验证全部单元测试通过
- [ ] 6.10 运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证 Markdown 渲染管线无回归

## 7. E2E 测试

- [ ] 7.1 新增 `tests/e2e/ocr-tool.spec.ts`：mock PaddleOCR API 返回 Markdown 表格，验证「选 Qwen3-8B → 开启 OCR → 上传图片（此时上传按钮应可见）→ 输入『提取文字』→ 看到 LLM 调用工具 → 看到 Markdown 表格渲染」
- [ ] 7.2 E2E 验证：选 Qwen3.5-4B（vision=true）→ OCR 按钮可见 → 上传图片始终可用
- [ ] 7.3 E2E 验证：选 GLM-Z1（toolCalling=false）时 OCR 按钮不渲染
- [ ] 7.4 E2E 验证：选 Qwen3-8B + OCR 关闭时，图片上传按钮不可见
- [ ] 7.5 E2E 验证：从 Qwen3-8B（开启 OCR）切换到 GLM-Z1，OCR toggle 自动关闭
- [ ] 7.6 E2E 验证：OCR 开启但用户纯文本对话（无图片），LLM 不调用 OCR 工具
- [ ] 7.7 E2E mock 流式输出：tool-input-available 事件应包含 imageUrl、tool-output-available 事件应包含 Markdown 结果
- [ ] 7.8 运行 `pnpm test:e2e` 验证全部 E2E 测试通过

## 8. 文档同步

- [ ] 8.1 更新 `docs/API.md`：在请求 body 字段表中新增 `enable_ocr` 字段说明（类型 boolean，默认 false，仅 toolCalling 模型生效）
- [ ] 8.2 在 `docs/API.md` 工具列表中新增 `extractTextFromImage` 工具说明（参数、返回值、调用场景）
- [ ] 8.3 在 `docs/模型.md` 的 PaddleOCR 行补充说明：「作为 OCR 工具被通用对话模型调用，不在模型选择器中暴露」

## 9. 集成验证

- [ ] 9.1 启动 `pnpm dev`，切换到 Qwen3-8B 模型
- [ ] 9.2 验证 OCR toggle 按钮在「联网」按钮后面显示，默认关闭
- [ ] 9.3 验证 Qwen3-8B + OCR 关闭时图片上传按钮不可见
- [ ] 9.4 点击 OCR toggle 按钮，验证高亮 + tooltip 变化 + 图片上传按钮出现
- [ ] 9.5 上传图片 + 输入「提取文字」+ 发送，验证 LLM 调用 OCR 工具（ToolInvocation 组件显示状态）
- [ ] 9.6 验证最终输出包含 Markdown 表格/标题/印章标记，渲染正常
- [ ] 9.7 切换到 Qwen3.5-4B，验证图片上传按钮始终可见、OCR 按钮可见
- [ ] 9.8 切换到 GLM-Z1 模型，验证 OCR 按钮隐藏
- [ ] 9.9 切换回 Qwen3-8B，验证 OCR toggle 自动关闭（之前开启的状态不保留）
- [ ] 9.10 纯文本对话（无图片），验证 LLM 不调用 OCR 工具
- [ ] 9.11 **验证流式输出正常**：OCR 工具调用场景下打字机效果不被破坏（参考 AGENTS.md 注意事项）
- [ ] 9.12 运行 `pnpm typecheck && pnpm lint && pnpm test:unit` 三件套最终验证
