# my-chat

基于 Nuxt 3 + Vercel AI SDK 的通用 AI 对话应用，支持 Markdown + LaTeX 公式安全渲染、图片对话（多模态）、语音消息（录音转写 + 情感识别）、TTS 语音朗读、工具调用（天气、搜索、OCR、文生图、GitHub 文件读取）与跨会话长期记忆，适配平板和手机屏幕。

## 技术栈

| 层级         | 技术                                 | 说明                 |
| ------------ | ------------------------------------ | -------------------- |
| **前端框架** | Nuxt 3 + Vue 3                       | SSR/SSG 支持         |
| **AI SDK**   | Vercel AI SDK (`@ai-sdk/vue` + `ai`) | `useChat()` 流式对话 |
| **UI**       | Tailwind CSS + shadcn-vue 风格       | 响应式布局           |
| **后端 API** | Nuxt Server Routes (Nitro)           | 无需额外服务器       |
| **数据库**   | PostgreSQL 18 + Drizzle ORM          | 类型安全的 SQL       |
| **Markdown** | marked + DOMPurify                   | 安全渲染             |
| **数学公式** | KaTeX                                | LaTeX 公式支持       |

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env

# 启动数据库（Docker）
docker compose up -d

# 推送表结构
pnpm db:push

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
DATABASE_URL=postgresql://user:password@localhost:5434/dbname

# 可选：图片对话（ImgBB 图床，硅基流动不支持 base64 图片）
IMGBB_API_KEY=your-api-key

# 可选：联网搜索（Tavily）
TAVILY_API_KEY=your-tavily-api-key

# 可选：GitHub 文件读取工具（不配置可读公开仓库）
GITHUB_TOKEN=
```

## 项目结构

```
my-chat/
├── pages/
│   ├── index.vue              # 首页（跳转 /ai-chat）
│   └── ai-chat.vue            # AI 聊天主页面（虚拟滚动 + 会话管理）
├── components/chat/
│   ├── ChatInput.vue          # 聊天输入框（多行自动增高、图片上传、语音入口）
│   ├── MarkdownRenderer.vue   # Markdown + KaTeX + Mermaid 渲染组件
│   ├── CodeBlock.vue          # 代码高亮块（highlight.js）
│   ├── MermaidBlock.vue       # Mermaid 图表渲染块
│   ├── SessionSidebar.vue     # 会话侧边栏
│   ├── ThinkingProcess.vue    # 深度思考过程展示
│   ├── ToolInvocation.vue     # 工具调用结果展示
│   ├── VoiceMessageBubble.vue # 语音消息气泡（播放/情感标签/转文字）
│   └── QuickPromptIcon.vue    # 快捷提示图标
├── components/
│   ├── ToastProvider.vue       # 全局 Toast 通知
│   └── ConfirmDialogProvider.vue # 全局确认对话框
├── composables/
│   ├── useChatConfig.ts        # 聊天配置（模型选择、思考开关）
│   ├── useChatSession.ts       # 会话管理
│   ├── useToast.ts             # Toast 通知
│   ├── useConfirmDialog.ts     # 确认对话框
│   └── useTooltip.ts           # 工具提示
├── utils/
│   ├── markdown.ts             # Markdown → HTML（含公式提取、DOMPurify 净化）
│   ├── katex.ts                # KaTeX 占位符 → 数学符号渲染（延迟加载）
│   ├── highlight.ts            # 代码高亮工具
│   ├── mermaid.ts              # Mermaid 图表渲染
│   └── image-sizes.ts          # 图片尺寸提取（防 CLS）
├── server/api/
│   ├── chat.post.ts            # 流式聊天接口（streamText + reasoning 处理）
│   ├── sessions.ts             # 会话 CRUD（GET / POST）
│   ├── sessions/[id]/index.ts  # 单会话消息 / 删除 / 重命名
│   ├── sessions/[id]/archive-memory.post.ts # 会话归档（长期记忆入库）
│   ├── messages.post.ts        # 消息保存（Workflow 路径独立落库）
│   ├── generate-image.post.ts  # 文生图接口
│   ├── audio/transcribe.post.ts # 语音消息 ASR 转写
│   ├── audio/tts.post.ts       # TTS 语音合成（朗读）
│   ├── audio/[id].get.ts       # 语音消息音频文件获取
│   └── models.ts               # 可用模型列表
├── server/tools/
│   ├── weather.ts              # 天气查询核心函数（供 MCP 复用）
│   ├── web-search.ts           # 网页搜索工具（Tavily）
│   ├── ocr-document.ts         # OCR 文档识别工具（PaddleOCR-VL）
│   ├── generate-image.ts       # 文生图 Agent 工具（Kolors）
│   ├── recall-memory.ts        # 长期记忆检索工具（Agentic RAG）
│   ├── github-file.ts          # GitHub 文件读取工具
│   ├── sensevoice.ts           # SenseVoiceSmall ASR 封装
│   └── telespeech.ts           # TeleSpeechASR 方言补强封装
├── server/mcp/
│   └── weather-server.ts       # MCP Weather Server（stdio 传输）
├── server/utils/
│   ├── imgbb.ts                # ImgBB 图床上传
│   ├── reasoning-provider.ts   # 自定义 Provider（处理 reasoning_content）
│   ├── embedding.ts            # BAAI/bge-m3 embedding（1024 维）
│   ├── reranker.ts             # BAAI/bge-reranker-v2-m3 重排序
│   ├── image-generation.ts     # 硅基流动文生图 API 封装
│   └── memory-archive.ts       # 会话归档（重要度筛选 + 入库）
├── server/db/
│   ├── schema.ts               # Drizzle 表定义
│   └── index.ts                # postgres-js 连接实例
├── server/config/
│   └── models.ts               # 模型白名单与能力定义
├── server/middleware/
│   └── security.ts             # CSP / 限流 / 参数校验
├── openspec/                   # 功能提案与规范（含 Agent 演进路线）
├── docs/                       # API / 数据库 / 模型文档
├── .env.example                # 环境变量模板
├── docker-compose.yml          # PostgreSQL 容器
├── drizzle.config.ts           # ORM 配置
└── nuxt.config.ts              # Nuxt 配置
```

## API 接口

| 方法    | 路径                                | 说明                          |
| ------- | ----------------------------------- | ----------------------------- |
| `POST`  | `/api/chat`                         | 流式对话（SSE）               |
| `GET`   | `/api/sessions`                     | 会话列表（含消息计数）        |
| `POST`  | `/api/sessions`                     | 创建会话                      |
| `GET`   | `/api/sessions/:id`                 | 会话历史消息                  |
| `PATCH` | `/api/sessions/:id`                 | 重命名会话                    |
| `DELETE`| `/api/sessions/:id`                 | 删除会话                      |
| `POST`  | `/api/sessions/:id/archive-memory`  | 会话归档（长期记忆入库）      |
| `POST`  | `/api/messages`                     | 消息保存（Workflow 独立落库） |
| `POST`  | `/api/generate-image`               | 文生图                        |
| `POST`  | `/api/audio/transcribe`             | 语音消息 ASR 转写             |
| `POST`  | `/api/audio/tts`                    | TTS 语音合成（朗读）          |
| `GET`   | `/api/audio/:id`                    | 语音消息音频文件获取          |
| `GET`   | `/api/models`                       | 可用模型列表                  |

完整接口定义见 [docs/API.md](docs/API.md)。

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
├── metadata: jsonb (存储 model、images、audio 等信息)
└── created_at: timestamp

feedbacks (反馈)
├── id: text (PK)
├── message_id: text (FK → messages.id, CASCADE)
├── type: text
└── created_at: timestamp

memory_vectors (长期记忆向量)
├── id: text (PK)
├── message_id: text (FK → messages.id, CASCADE)
├── session_id: text (FK → sessions.id, CASCADE)
├── content: text (消息文本快照)
├── embedding: vector(1024) (HNSW 索引，余弦距离检索)
├── role: text
├── created_at: timestamp (消息原始创建时间)
└── archived_at: timestamp (归档时间)
```

完整表结构见 [docs/db-schema.md](docs/db-schema.md)。
