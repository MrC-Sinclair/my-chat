# AI 学习平板

基于 Nuxt 3 + Vercel AI SDK 的 AI 对话学习助手，面向深圳外国语学校学生场景。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | Nuxt 3 + Vue 3 | SSR/SSG 支持 |
| **AI SDK** | Vercel AI SDK (`@ai-sdk/vue` + `ai`) | `useChat()` 流式对话 |
| **UI** | Tailwind CSS + shadcn-vue 风格 | 响应式布局 |
| **后端 API** | Nuxt Server Routes (Nitro) | 无需额外服务器 |
| **数据库** | PostgreSQL 18 + Drizzle ORM | 类型安全的 SQL |
| **Markdown** | marked + DOMPurify | 安全渲染 |
| **数学公式** | KaTeX | LaTeX 公式支持 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env

# 启动数据库（Docker）
docker compose up -d

# 推送表结构
npx drizzle-kit push

# 开发运行
pnpm dev
```

访问 http://localhost:3000/ai-chat

## 环境配置

```env
# LLM Provider（以硅基流动为例）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=Qwen/Qwen3-8B

# 深度思考模式（默认开启）
ENABLE_THINKING=true

# 数据库
DATABASE_URL=postgresql://sw_pad:sw_pad_2026@localhost:5434/sw_pad
```

## 项目结构

```
AI学习平板/
├── pages/
│   ├── index.vue              # 首页
│   └── ai-chat.vue            # AI 聊天主页面（useChat）
├── components/chat/
│   ├── MarkdownRenderer.vue    # Markdown + KaTeX 渲染组件
│   └── CodeBlock.vue          # 代码高亮块
├── server/api/
│   ├── chat.post.ts           # 流式聊天接口（streamText）
│   ├── sessions.ts            # 会话 CRUD（GET / POST）
│   └── sessions/[id].ts       # 单会话消息 / 删除
├── server/db/
│   ├── schema.ts              # Drizzle 表定义
│   └── index.ts               # postgres-js 连接实例
├── utils/
│   ├── markdown.ts            # Markdown → HTML（含公式提取）
│   └── katex.ts               # KaTeX 占位符 → 数学符号渲染
├── .env.example               # 环境变量模板
├── docker-compose.yml         # PostgreSQL 容器
├── drizzle.config.ts          # ORM 配置
└── nuxt.config.ts             # Nuxt 配置
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 流式对话（SSE） |
| `GET` | `/api/sessions` | 会话列表（含消息计数） |
| `POST` | `/api/sessions` | 创建会话 |
| `GET` | `/api/sessions/:id` | 会话历史消息 |
| `DELETE` | `/api/sessions/:id` | 删除会话 |

## 数据库设计

```
sessions (会话)
├── id: text (PK)
├── title: text
├── created_at: timestamp
└── updated_at: timestamp

messages (消息)
├── id: text (PK)
├── session_id: text (FK → sessions.id, CASCADE)
├── role: 'user' | 'assistant' | 'system'
├── content: text
├── metadata: jsonb (存储 model 等信息)
└── created_at: timestamp

feedbacks (反馈)
├── id: text (PK)
├── message_id: text (FK → messages.id, CASCADE)
├── type: text
└── created_at: timestamp
```

---

## 核心实现细节（给后来者的参考）

### 1. Markdown 渲染如何防 XSS？

**文件**: [utils/markdown.ts](utils/markdown.ts)

AI 返回的内容是不可信的用户输入，必须经过严格净化。本项目采用 **两层防护**：

#### 第一层：DOMPurify 白名单过滤

```typescript
import DOMPurify from 'dompurify'

const sanitizedHtml = DOMPurify.sanitize(html, {
  // 只允许安全标签
  ALLOWED_TAGS: [
    'h1'-'h6', 'p', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'a', 'strong', 'em', 'table', 'img', 'span', 'div',
    // KaTeX MathML 标签（必须放行，否则公式被过滤）
    'math', 'mrow', 'mi', 'mo', 'mspace',
    'mfrac', 'msqrt', 'mroot', 'msub', 'msup', ...,
    // KaTeX SVG 标签
    'svg', 'path', 'line', 'g', 'use', ...
  ],
  // 只允许安全属性
  ALLOWED_ATTR: [
    'href', 'class', 'src', 'alt',
    'viewBox', 'd', 'fill', 'stroke',  // SVG 属性
    ...
  ]
})
```

> **关键点**: 默认的 DOMPurify 不认识 `<math>`、`<svg>`、`<mrow>` 等 KaTeX 标签，会把它们全部删掉！必须显式加入白名单。

#### 第二层：v-html 使用

```vue
<!-- MarkdownRenderer.vue -->
<div ref="containerRef" v-html="htmlContent" />
```

`v-html` 本身不转义内容，所以 **必须在写入前完成净化**。永远不要将未净化的字符串直接传入 `v-html`。

---

### 2. KaTeX 如何与 Markdown 共存？

**核心问题**: `marked`（Markdown 解析器）不认识 `$...$` 和 `$$...$$` LaTeX 语法，会把它们当普通文本或错误解析。

**解决方案 — 三阶段流水线**:

```
原始文本: "勾股定理 $$a^2+b^2=c^2$$ 很重要"
    ↓
[阶段1] 提取公式，替换为占位符
处理中: "勾股定理 %%MATHBLOCK0%% 很重要"
    ↓
[阶段2] marked 解析 Markdown → HTML
HTML: "<p>勾股定理 %%MATHBLOCK0%% 很重要</p>"
    ↓
[阶段3] DOMPurify 净化 + 还原占位符
最终: "<p>勾股定理 <div class="math-block" data-formula="a^2+b^2=c^2">...</div> 重要</p>"
    ↓
[阶段4] KaTeX 渲染占位符元素
显示: 勾股定理 a²+b²=c²（漂亮的数学符号）重要
```

#### 阶段 1：公式提取 ([utils/markdown.ts:14-33](utils/markdown.ts#L14))

```typescript
const mathBlockRegex = /\$\$([\s\S]+?)\$\$/g      // $$...$$ 块级
const mathInlineRegex = /(?<!\$)\$(?!\$)([^\n]+?)(?<!\$)\$(?!\$)/g  // $...$ 行内

// 先提取所有公式，用占位符替换
let processedText = rawText.replace(mathBlockRegex, (_, formula) => {
  const index = mathBlocks.length
  mathBlocks.push(formula.trim())
  return `\n%%MATHBLOCK${index}%%\n`     // 替换为占位符
})
```

> **注意正则细节**: 行内公式的 `(?<!\$)` 和 `(?!\$)` 是负向断言，避免误匹配 `$$...$$`（块级公式边界）。

#### 阶段 2：Markdown 解析

```typescript
const html = marked.parse(processedText) as string
// 此时 $$a^2$$ 已经被保护为 %%MATHBLOCK0%%，不会被 marked 破坏
```

#### 阶段 3：还原占位符 ([utils/markdown.ts:66-82](utils/markdown.ts#L66))

```typescript
// 在净化后的 HTML 中把占位符替换回带 data-formula 的容器
sanitizedHtml = sanitizedHtml.replace(
  `%%MATHBLOCK${index}%%`,
  `<div class="math-block" data-formula="${escapeAttr(formula)}">${escapeHtml(formula)}</div>`
)
```

> **为什么用 `data-formula`？** 因为 DOMPurify 可能修改 innerHTML 内容，但 `dataset.formula` 可以保留原始 LaTeX 字符串供 KaTeX 使用。

#### 阶段 4：KaTeX 渲染 ([utils/katex.ts](utils/katex.ts))

```typescript
export function renderMath(element: HTMLElement): void {
  // 找到所有占位符容器
  const blockElements = element.querySelectorAll('.math-block')
  const inlineElements = element.querySelectorAll('.math-inline')

  blockElements.forEach((el) => {
    const formula = el.dataset.formula || el.textContent || ''
    el.innerHTML = katex.renderToString(formula, { displayMode: true })
    // 输出: <span class="katex">...MathML/SVG...</span>
  })
}
```

**调用时机** ([components/chat/MarkdownRenderer.vue:14-25](components/chat/MarkdownRenderer.vue#L14)):

```typescript
watch(() => props.content, () => {
  nextTick(() => {
    renderCodeBlocks()    // 代码高亮
    renderMath(containerRef.value!)  // 公式渲染
  })
}, { immediate: true })
```

---

### 3. 数据持久化的时序

**文件**: [server/api/chat.post.ts](server/api/chat.post.ts)

数据保存发生在 **流式响应完成后**（`onFinish` 回调），而非每条 chunk 都写库：

```
用户发送消息
    ↓
[1] streamText() 开始流式输出给前端
    ↓
[2] AI 逐 token 返回（SSE stream）
    ↓ 前端实时显示每个 token
    ↓
[3] AI 回复完毕 → onFinish 回调触发
    ↓
[4] saveMessagesToDb() 执行：
    ├─ INSERT user 最后一条消息
    ├─ INSERT assistant 完整回复
    └─ UPDATE sessions.updated_at = NOW()
    ↓
[5] 前端 loadSessions() 刷新列表（messageCount 更新）
```

#### 关键代码

```typescript
return streamText({
  model: llmProvider(LLM_MODEL),
  system: systemPrompt,
  messages,
  onFinish: async ({ text }) => {        // ← 回复完成后才触发
    if (!sessionId) return                // 无 sessionId 则不保存
    await saveMessagesToDb(sessionId, messages, text)
  }
}).toDataStreamResponse()
```

#### 为什么不在发送时立即保存用户消息？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **当前方案：onFinish 统一保存** | 事务一致性好，一次写入 user+assistant | 如果中途失败，用户消息也丢失 |
| **替代方案：发送时存 user，回复时存 assistant** | 用户消息不丢失 | 两次 DB 写入，可能只有一半成功 |

> **权衡选择**: 当前方案更简洁，适合学习助手场景。如果需要更强的可靠性，可以在发送时单独 INSERT user 消息。

#### 消息去重策略

```typescript
const lastUserMessage = [...chatMessages]
  .reverse()
  .find((msg) => msg.role === 'user')  // 只取最后一条 user 消息
```

因为 `messages` 数组包含完整历史，每次请求都带上了之前的对话，所以只保存**最后一条新增的 user 消息**，避免重复插入历史记录。
