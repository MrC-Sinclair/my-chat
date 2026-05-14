---
alwaysApply: true
scene: git_message
---

# Git 提交规范与代码审查规则

## Commit Message 格式

```
type(scope): 简短描述
```

- 使用中文描述，不用句号结尾
- 描述"做了什么"而非"怎么做的"：✅ `添加图片上传功能` ❌ `使用ImgBB API实现图片上传`
- 首行不超过 72 个字符

## type 类型

| type     | 用途                       | 示例                                                 |
| -------- | -------------------------- | ---------------------------------------------------- |
| feat     | 新功能                     | feat(chat): 添加Mermaid流程图支持                    |
| fix      | 修复 bug                   | fix(chat): 修复中文输入法下回车键触发提交的问题      |
| refactor | 重构（不改变功能）         | refactor(chat): 增加上下文消息数量限制并优化处理逻辑 |
| style    | 代码格式调整（不影响逻辑） | style: 统一缩进风格                                  |
| docs     | 文档变更                   | docs: 更新环境变量说明                               |
| perf     | 性能优化                   | perf(chat): 实现消息列表虚拟滚动以提升性能           |
| test     | 测试相关                   | test: 添加Markdown渲染单元测试                       |
| chore    | 构建/工具/依赖变更         | chore: 升级Nuxt到3.21                                |

## scope 范围

根据项目架构选择合适的 scope：

| scope    | 对应目录/模块                                       |
| -------- | --------------------------------------------------- |
| chat     | pages/ai-chat.vue、components/chat/                 |
| markdown | utils/markdown.ts、utils/katex.ts、MarkdownRenderer |
| api      | server/api/                                         |
| db       | server/db/、schema.ts                               |
| tools    | server/tools/                                       |
| config   | server/config/、nuxt.config.ts                      |
| ui       | 通用UI组件、样式                                    |
| 无       | 跨模块或全局变更                                    |

## Commit 规则

1. **一个 commit 只做一件事**：混合多种 type 的变更应拆分为多个 commit
2. **scope 要具体**：`feat(chat)` 比 `feat` 更好，`feat(markdown)` 比 `feat(chat)` 更精确
3. **描述要说明"做了什么"而非"怎么做的"**：✅ `feat(chat): 添加图片上传功能` ❌ `feat(chat): 使用ImgBB API实现图片上传`
4. **破坏性变更加 `!`**：`feat(api)!: 重构聊天接口请求格式`
5. **不要在 commit message 中包含敏感信息**（API Key、密码等）

## Bug 审查思维指引

生成 commit message 前，必须**深入阅读 diff 中的每一行代码变更**，像 code reviewer 一样主动推理，而非机械对照清单。按以下思维框架逐层分析：

### 第一步：理解意图

- 这次变更想做什么？改了哪些文件？涉及哪些模块？
- 变更的影响范围是什么？是否会影响其他模块？

### 第二步：追踪数据流

- **输入从哪来**：函数参数、用户输入、API 响应、URL 参数 — 这些值可能为空、为 null、为异常值吗？
- **数据怎么流转**：变量经过哪些处理步骤？中间是否有类型转换、隐式 coercion？
- **输出到哪去**：结果写入了 DOM、数据库、网络请求 — 写入前是否校验？写入失败怎么办？

### 第三步：推演边界场景

对每个变更点，主动问自己：

- **空值/null/undefined**：如果输入为空会怎样？数组为空？对象缺字段？
- **竞态条件**：异步操作之间是否有先后依赖？快速连续触发会怎样？组件卸载后回调还在执行吗？
- **状态不一致**：两个相关状态是否可能不同步？一个更新了另一个没更新？
- **资源泄漏**：事件监听、定时器、订阅是否在不需要时清理了？
- **索引越界**：数组访问是否可能越界？字符串截取是否可能截错？

### 第四步：检查错误处理

- try/catch 是否覆盖了关键操作？catch 后是静默吞掉还是正确处理？
- async 函数是否缺少 await？Promise 是否缺少 .catch？
- 用户看到的错误信息是否友好？还是只 console.error？

### 第五步：验证逻辑正确性

- 条件判断是否覆盖了所有分支？else 分支是否遗漏？
- 循环的终止条件是否正确？是否会死循环？
- 提前 return 是否导致后续必要逻辑被跳过？
- 新增代码与现有代码的调用关系是否正确？

### 第六步：对照项目已知陷阱

完成主动推理后，再对照下方清单检查项目特有的已知问题。

## 项目已知问题清单

### 🔴 必须阻止提交的问题（阻断项）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **XSS 漏洞** | 未净化的字符串直接传入 `v-html`，必须经过 `renderMarkdown()` 处理 |
| 2 | **密钥泄露** | API Key、密码等硬编码在前端代码中，密钥只能放在 `runtimeConfig` 非 public 字段或 `.env` |
| 3 | **SSE 流破坏** | 修改了 `nuxt.config.ts` 中间件或 `res.write`/`res.end` 相关代码，可能导致流式输出被缓冲 |
| 4 | **数据库写库时机** | 消息持久化在 `onChunk` 中执行而非 `onFinish`，会导致频繁写库 |
| 5 | **DOMPurify 白名单缺失** | 新增 KaTeX/Markdown 相关标签但未加入 DOMPurify 白名单，公式会被过滤 |

### 🟡 需要警告的问题（在 commit body 中标注 ⚠️）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **SSR 水合不匹配** | 在模板/computed 中使用 `Date.now()`、`Math.random()`、`window`、`document` 等不确定值或浏览器 API，未用 `onMounted` 或 `<ClientOnly>` 守卫 |
| 2 | **触摸设备不可达** | 按钮/操作使用 `hover:opacity-100` 但手机端无替代方案，触摸设备上不可见 |
| 3 | **触摸目标过小** | 纯图标按钮手机端未设 `min-w-[36px] min-h-[36px]`，核心操作未设 `min-w-[44px] min-h-[44px]` |
| 4 | **原生对话框** | 使用了 `confirm()`、`alert()`、`prompt()`，应替换为 `useConfirmDialog()` |
| 5 | **缺少错误反馈** | API 请求失败仅 `console.error`，未通过 `useToast()` 向用户展示 |
| 6 | **缺少交互反馈** | 可点击元素无 `active:scale-95`，加载状态无 spinner，状态切换无 transition |
| 7 | **响应式缺失** | UI 变更未同时写手机（默认）和平板（`sm:`）样式 |
| 8 | **Unicode 图标** | 使用 Unicode 字符（☰、✕）作为图标，应替换为内联 SVG |
| 9 | **useChat body 未 computed** | `useChat` 的 `body` 参数未用 `computed()` 包裹，sessionId 等动态值不会更新 |
| 10 | **schema 变更未同步** | 修改了 `server/db/schema.ts` 但未提示需运行 `pnpm db:push` |
| 11 | **API 缺少参数校验** | 新增 API 路由未包含参数校验和 `createError()` 错误处理 |
| 12 | **onMounted 直接操作 DOM** | `onMounted` 中用 `createElement`/`replaceChild` 直接操作 DOM，会破坏 SSR 水合 |

### 🟢 建议关注的问题（在 commit body 中标注 💡）

| # | 检查项 | 说明 |
|---|--------|------|
| 1 | **缺少测试** | 修改核心逻辑但未补充对应单元测试 |
| 2 | **行内代码颜色** | 使用了红色（`#e11d48`）而非柔和紫色（`#7c3aed`）作为行内代码颜色 |
| 3 | **时间显示** | 会话列表等场景未显示相对时间（"刚刚"、"3 分钟前"） |
| 4 | **折叠/展开硬切** | 用 `v-if` 直接切换而非 `max-height` + `transition` 平滑过渡 |
| 5 | **图标按钮无提示** | 纯图标按钮未用 `v-tooltip` 包裹，使用了原生 `title` 属性 |

## 审查输出格式

commit message body 中按以下格式输出审查结果：

```
🐛 Bug: 1  ⚠️ 阻断项: 0  🟡 警告: 2  💡 建议: 1

🐛 竞态: switchSession 中未清空旧消息就加载新会话，快速切换可能串消息
🟡 SSR: 组件中使用了 window.innerWidth，未用 onMounted 守卫
🟡 触摸: 编辑按钮使用 hover:opacity-100，手机端不可见
💡 测试: 修改了消息去重逻辑，建议补充单元测试
```

无问题时仅输出：

```
✅ 代码审查通过
```
