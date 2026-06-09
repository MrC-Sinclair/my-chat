---
description: 代码审查规则，在代码变更、提交前自动应用，检查项目特有的已知陷阱和边界场景
alwaysApply: false
---

# 代码审查规则

生成 commit message 或审查代码变更时，必须**深入阅读 diff 中的每一行代码变更**，像 code reviewer 一样主动推理，而非机械对照清单。

## 审查思维框架

### 第一步：理解意图

- 这次变更想做什么？改了哪些文件？涉及哪些模块？
- 变更的影响范围是什么？是否影响流式输出、Markdown 渲染、数据库操作？

### 第二步：追踪数据流

- **输入从哪来**：用户消息、API 请求参数、数据库查询结果 — 这些值可能为空、为 null 吗？
- **数据怎么流转**：消息经过 `useChat()` → `POST /api/chat` → `streamText()` → `onFinish` 持久化 — 中间是否有类型转换或格式处理？
- **输出到哪去**：SSE 流式响应、数据库写入、`v-html` 渲染 — 写入/渲染前是否校验和净化？

### 第三步：推演边界场景

- **空值/null/undefined**：会话 ID 为空时查询数据库？API 参数缺失？图片上传失败后继续发送？
- **竞态条件**：快速连续发送消息？流式输出未完成时切换会话？同时删除和重命名同一会话？
- **状态不一致**：`isLoading` 为 true 但请求已失败未重置？侧边栏展开/折叠状态与实际 DOM 不匹配？
- **资源泄漏**：流式连接是否在异常时正确关闭？事件监听器是否在组件卸载时移除？定时器是否清理？
- **SSR 水合不匹配**：模板中是否使用了 `Date.now()`、`Math.random()` 等不确定值？浏览器 API 是否有守卫？

### 第四步：检查错误处理

- API 请求是否都有 `catch` 处理？失败后是否通过 `useToast()` 向用户展示？
- 数据库操作是否处理了连接异常和约束冲突？
- `streamText()` 的 `onError` 回调是否正确重置了加载状态？
- 用户看到的错误信息是否友好（Toast 提示而非原始堆栈）？

### 第五步：验证逻辑正确性

- Markdown 渲染管线是否保持了正确的处理顺序（代码块提取 → 公式提取 → marked → DOMPurify → 还原）？
- 新增模型是否同时更新了 `server/config/models.ts` 白名单和 `ALLOWED_MODEL_VALUES` 校验？
- `v-html` 绑定的内容是否都经过了 `renderMarkdown()` 处理？
- 数据库 Schema 变更后是否运行了 `pnpm db:push`？

### 第六步：对照项目已知陷阱

完成主动推理后，再对照下方清单检查项目特有的已知问题。

## 项目已知问题清单

### 🔴 必须阻止提交的问题（阻断项）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **未净化的内容传入 v-html** | 必须经过 `renderMarkdown()` 处理（内含 DOMPurify 净化），否则存在 XSS 风险 |
| 2 | **DOMPurify 白名单缺少 MathML/SVG** | 修改 DOMPurify 配置后必须确认白名单仍包含 `math`、`mrow`、`mi`、`mfrac`、`svg`、`path` 等标签，否则 KaTeX 公式无法渲染 |
| 3 | **消息持久化写在 onChunk 中** | 必须在 `streamText` 的 `onFinish` 回调中执行，`onChunk` 中写库会导致大量重复写入 |
| 4 | **密钥暴露到前端** | 密钥只能放在 `runtimeConfig` 的非 public 字段或 `.env` 中，禁止出现在 `runtimeConfig.public` 或前端代码中 |
| 5 | **中间件/插件缓冲了 SSE 流** | 修改 `nuxt.config.ts` 的 Vite 中间件、`security.ts`、或任何涉及 `res.write`/`res.end` 的代码，必须确保非 HTML 响应（`/api/chat` 的 SSE 流）直接透传，否则打字机效果消失 |
| 6 | **SSR 水合不匹配** | 模板/computed 中使用了 `Date.now()`、`Math.random()`、`crypto.randomUUID()` 等不确定值，或无守卫地访问 `window`/`document`/`localStorage` |
| 7 | **修改 Schema 未同步数据库** | 改了 `server/db/schema.ts` 但未运行 `pnpm db:push` |
| 8 | **删除运行时依赖** | `dompurify`、`highlight.js`、`katex`、`marked` 在 devDependencies 中但运行时使用，误删会导致渲染崩溃 |

### 🟡 需要警告的问题（在 commit body 中标注 ⚠️）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **新增模型未同步配置** | 新增模型需同时更新 `server/config/models.ts` 的能力定义和白名单校验 |
| 2 | **useChat body 未用 computed** | `body` 参数必须用 `computed()` 包裹，否则 sessionId 等动态值不会随请求更新 |
| 3 | **新增 AI 工具未注册** | 在 `server/tools/` 创建了工具文件但未在 `chat.post.ts` 的 `tools` 参数中注册 |
| 4 | **新增 API 路由缺少校验** | 必须包含参数校验和 `createError()` 错误处理 |
| 5 | **错误仅 console.error 未通知用户** | API 请求失败必须通过 `useToast()` 展示，禁止静默处理 |
| 6 | **图片处理缺少失败兜底** | ImgBB 上传失败后是否中断发送？图片 URL 无效时是否有降级处理？ |
| 7 | **Markdown 渲染管线顺序变动** | 代码块提取 → 公式提取 → marked → DOMPurify → 占位符还原的顺序不可打乱 |
| 8 | **动态挂载组件未处理生命周期** | `MarkdownRenderer.vue` 中 `createApp(CodeBlock).mount()` 动态挂载的实例需要在父组件卸载时手动 unmount |
| 9 | **缺少加载状态** | 异步操作（发送消息、加载会话、上传图片）未显示 loading 指示器 |
| 10 | **原生对话框** | 使用了 `confirm()`/`alert()`/`prompt()`，必须替换为 `useConfirmDialog()` |

### 🟢 建议关注的问题（在 commit body 中标注 💡）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **缺少测试** | 修改核心逻辑（Markdown 渲染、流式处理、数据库操作）但未补充对应单元测试 |
| 2 | **Markdown 渲染变更未跑专项测试** | 修改了 `utils/markdown.ts`、`katex.ts`、`highlight.ts` 但未运行 `pnpm vitest run tests/unit/markdown.test.ts` |
| 3 | **hover-only 按钮在触摸设备不可达** | `opacity-0 group-hover:opacity-100` 的按钮在手机端不可见，手机端应始终显示 |
| 4 | **触摸目标过小** | 纯图标按钮未保证 `min-w-[36px] min-h-[36px]`（手机端）或输入区按钮未达 `44px` |
| 5 | **缺少过渡动画** | 状态切换、面板展开使用 `v-if` 硬切而非 `transition` 平滑过渡 |
| 6 | **Unicode 字符作为图标** | 使用了 ☰、✕ 等 Unicode 字符，应替换为内联 SVG |
| 7 | **saveMessagesToDb 重复插入** | 该函数只保存最后一条用户消息（反向查找），注意调用方式避免重复插入 |
| 8 | **enable_thinking 参数兼容性** | 视觉/推理模型不支持此参数，需通过 `getModelCapabilities()` 判断后决定是否启用 |
| 9 | **单文件过长** | `ai-chat.vue` 等核心文件持续膨胀，新增逻辑应考虑拆分到 composables/ |

## 审查输出格式

commit message body 中按以下格式输出审查结果：

```
🐛 Bug: 1  ⚠️ 阻断项: 0  🟡 警告: 2  💡 建议: 1

🐛 XSS: 新增的消息预览直接绑定 v-html 未经 renderMarkdown() 净化
🟡 流式: 修改了 security.ts 中间件但未验证 SSE 流式输出是否正常
🟡 模型: 新增 Qwen-VL 但未在 models.ts 中配置 capabilities
💡 测试: 修改了公式提取逻辑，建议运行 markdown 专项测试
```

无问题时仅输出：

```
✅ 代码审查通过
```
