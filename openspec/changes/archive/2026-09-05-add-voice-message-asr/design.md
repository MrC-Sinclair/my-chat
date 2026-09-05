## Context

my-chat 当前输入能力：文本输入、图片上传（多模态）、Web Speech API 语音输入（浏览器原生 SpeechRecognition，转写结果追加到输入框）、文生图。Web Speech API 在 Android WebView 中兼容性差（部分版本不支持或被拦截），且无法识别情感。

本次新增「语音消息」能力：用户录制完整语音 → 上传服务端 → 服务端 ASR 转写（SenseVoiceSmall 主力 + TeleSpeechASR 方言补强）→ 返回文本 + 情感 + 音频 URL → 前端以语音气泡展示并附带转文字折叠面板 → 转写文本作为 user 消息进入 `/api/chat` 流程，情感作为系统提示注入让 AI 情绪化回复。

> **模型可用性实测说明（2026-07-29）**：
> - **SenseVoiceSmall** ✅ 已确认在硅基流动 `/v1/audio/transcriptions` 端点可用（官方 API 文档列出）
> - **TeleSpeechASR** ⚠️ **未官方确认**。SiliconFlow 官方 API 文档（`/api-reference/audio/create-audio-transcriptions`）仅列出 `FunAudioLLM/SenseVoiceSmall` 一个模型，**未列出 `TeleAI/TeleSpeechASR`**。第三方资料（CSDN 博客）显示 TeleSpeechASR 由硅基流动提供（电信星辰），但**是否通过同一 `/v1/audio/transcriptions` 端点暴露未官方说明**。Workflow 需做端点可用性探测（详见决策 4）。

### ASR 模型 API 详情

| 项目 | SenseVoiceSmall | TeleSpeechASR |
|------|----------------|---------------|
| 硅基流动模型名 | `FunAudioLLM/SenseVoiceSmall` | `TeleAI/TeleSpeechASR` |
| 官方 API 端点 | `POST /v1/audio/transcriptions` | **同一端点（未官方列出）** |
| 端点可用性 | ✅ 已确认 | ⚠️ 需运行时探测（决策 4） |
| 请求格式 | `multipart/form-data`（`file` + `model`） | 同左 |
| 响应格式 | `{ text: "富文本转录" }`（含 `<|...|>` 标签） | `{ text: "纯文本" }`（未实测） |
| 费用 | **免费**（按 CSDN 资料按音频时长计费，待实测确认） | 按音频时长计费 |
| 输出特点 | 文本中嵌入 `<|EMOTION|>` / `<|LANG|>` / `<|EVENT|>` 标签 | 纯文本，无标签（推测，待实测） |
| 官方支持语种 | `zh`/`en`/`yue`/`ja`/`ko`/`nospeech`（共 6 种） | 普通话+英文+50种方言（官方宣传） |

### SenseVoiceSmall 富文本转录标签体系

SenseVoiceSmall 返回的 `text` 字段中嵌入以下标签，需在服务端解析后分离（实测基于 [FunAudioLLM/SenseVoice 官方 README](https://github.com/FunAudioLLM/SenseVoice) + FunASR 源码）：

**情感标签**（按 FunASR 源码枚举全部 8 种）：
| 标签 | 含义 | 映射到白名单 |
|------|------|--------------|
| `<|HAPPY|>` | 开心 | `happy` ✅ |
| `<|SAD|>` | 悲伤 | `sad` ✅ |
| `<|ANGRY|>` | 愤怒 | `angry` ✅ |
| `<|NEUTRAL|>` | 中性 | `neutral` ✅ |
| `<|EMO_UNKNOWN|>` | 情绪未知 | `null` |
| `<|FEARFUL|>` | 害怕 | `null`（不在 MVP 白名单） |
| `<|DISGUSTED|>` | 厌恶 | `null`（不在 MVP 白名单） |
| `<|SURPRISED|>` | 惊讶 | `null`（不在 MVP 白名单） |

**语种标签**（6 种，按 SenseVoice 官方 language 参数枚举）：
`<|zh|>`（普通话）、`<|en|>`（英语）、`<|yue|>`（粤语）、`<|ja|>`（日语）、`<|ko|>`（韩语）、`<|nospeech|>`（无语音）

**事件标签**（8 种，按 FunASR `postprocess_utils.py` 源码 `event_dict` 确认）：`<|BGM|>`（背景音乐）、`<|Speech|>`（语音噪声）、`<|Applause|>`（鼓掌）、`<|Laughter|>`（笑声）、`<|Cry|>`（哭声）、`<|Sneeze|>`（喷嚏）、`<|Breath|>`（呼吸声）、`<|Cough|>`（咳嗽）

**纯文本提取**：`cleanText = text.replace(/<\|[^|]+\|>/g, '').trim()`

**标签提取**：统一使用 `/<\|\s*([A-Za-z0-9_]+)\s*\|>/g` 提取所有标签名，再按集合分类：
- 情感白名单：`HAPPY`、`SAD`、`ANGRY`、`NEUTRAL`（其他情感标签归为 `null`）
- 事件集合：`BGM`、`Speech`、`Applause`、`Laughter`、`Cry`、`Sneeze`、`Breath`、`Cough`（8 种，按 FunASR 源码 `event_dict`）
- 语种集合：`zh`、`en`、`yue`、`ja`、`ko`、`nospeech`（6 种）

> **重要**：SenseVoice 情感标签大小写**不统一**（`HAPPY`/`SAD`/`ANGRY`/`NEUTRAL` 为大写，`EMO_UNKNOWN` 为大写，但部分旧文档误写为 `emo_unk`）。正则 `/[A-Za-z0-9_]+` 必须同时覆盖大小写，避免漏检 `EMO_UNKNOWN`。

### 音频格式

- 前端 MediaRecorder 采集 WebM/Opus（兼容性好、压缩率高）
- 服务端收到 WebM 后，使用 ffmpeg 转码为 WAV（16kHz / 16bit / mono / PCM）再送入 ASR API
- 转码后的 WAV 仅用于 API 调用，不落盘；原始 WebM 存 `server/uploads/audio/` 供回放

现有相关代码：
- `ChatInput.vue` 已有 Web Speech API 录音按钮（`toggleSpeechRecognition`），麦克风权限拒绝处理已存在（emit `speechError`）
- `server/api/chat.post.ts` line 27-37 `DEFAULT_SYSTEM_PROMPT` 是情感注入点；`saveMessagesToDb` 处理 user/assistant 消息落库（含 images metadata）
- `messages` 表 `metadata` JSONB 字段已用于存 `{ images }` / `{ model }`，可扩展存音频元信息
- `chat.post.ts` line 57 `UPLOAD_DIR = join(process.cwd(), 'public', 'uploads')` 是现有上传目录约定，Nuxt 默认暴露 `public/` 为静态服务

约束（来自 AGENTS.md）：
- ASR 走 Workflow（代码预编排），不走 Agent（非 LLM 决策）
- 模型调用失败返回 `{ error, detail }` 不 throw
- 音频文件通过 URL 传递，不进 LLM 上下文
- 触摸目标 ≥ 44px（手机端）
- 录音需麦克风授权，权限拒绝用 `useToast` 提示
- SSR 水合：浏览器 API 必须 `import.meta.client` 守卫或 `onMounted` 内调用
- 异步写操作必须防重复提交（录音按钮并发守卫）

约束（来自 2026-07-29 实测）：
- ffmpeg 必须安装并加入 PATH（实测 6.1.1 可用，已启用 matroska+opus 解码）
- ffprobe 必须可用（用于实测音频时长），与 ffmpeg 同源安装
- TeleSpeechASR 在 SiliconFlow `/v1/audio/transcriptions` 端点**未官方列出**，Workflow 需做端点可用性探测
- SenseVoice 官方仅支持 `zh`/`en`/`yue`/`ja`/`ko`/`nospeech` 6 种语种，`DIALECT_LANGUAGE_TAGS` 默认值修正为 `yue`（仅）

## Goals / Non-Goals

**Goals:**
- 提供独立于 Web Speech API 的「语音消息」交互：录制完整语音 → 服务端转写 → 语音气泡展示
- 通过 SenseVoiceSmall 获取情感信号，注入系统提示让 AI 回复贴合用户情绪
- 方言场景下通过 TeleSpeechASR 补强转写质量
- 音频文件本地存储 + TTL 自动清理，防止磁盘膨胀
- 适配 Android WebView 与手机端

**Non-Goals:**
- 不做 TTS（硅基流动免费清单无 TTS 模型，AI 回复仍为纯文本）
- 不替换现有 Web Speech API 语音输入（保留作为现代浏览器轻量输入方案，两者并存）
- 不做实时流式 ASR（录音完整后再上传转写）
- 不做情感信息的持久化与跨会话记忆（情感仅本次对话注入，不落库）
- 不做语音消息的转写结果编辑（转写即终稿，用户可手动输入纠正）

## Decisions

### 决策 1：ASR 转写走 Workflow，不包装为 `tool()` 交给 LLM

**选择**：`/api/audio/transcribe.post.ts` 内部按确定性流程预编排 —— 先调 SenseVoiceSmall，检测到方言语种标签时调 TeleSpeechASR 取更优结果。

**理由**：「先 SenseVoice 后 TeleSpeech」是确定性降级流程，不涉及工具组合决策（调用与否、顺序、次数都由代码写死）。按 AGENTS.md「核心判定标准」，代码预编排 = Workflow，符合「ASR 转写走 Workflow」约束。若包装为 `tool()` 交给 LLM 决策，反而违反规范。

**备选**：包装为 `tool()` 让 LLM 决定何时转写 —— 被否决，违反 Workflow 约束且 LLM 无法判断音频内容需要转写。

### 决策 2：音频文件存 `server/uploads/audio/`，TTL 自动清理

**选择**：音频文件存 `server/uploads/audio/<timestamp>-<uuid>.webm`（不对外暴露），通过 API 路由 `/api/audio/:id` 代理访问，路由内校验用户 session 权限。设 TTL（默认 7 天）定时清理过期文件。

**理由**：
- **安全考量**：语音消息可能包含敏感内容（密码、个人隐私），`public/` 目录无访问鉴权，任何人拿到 URL 就能播放。改为 `server/` 目录 + API 路由代理，可校验 session 权限
- **文件名 UUID**：使用 `<uuid>` 作为文件名的一部分，URL 不可猜测，防御枚举攻击
- 复用 `chat.post.ts` 现有 `UPLOAD_DIR = server/uploads` 约定，零新依赖
- ImgBB 主要面向图片，音频支持存疑（用户已确认不使用）
- 对象存储（COS/OSS）引入新依赖与成本，本地存储足够
- TTL 清理满足用户「自动删除防止服务器崩溃」需求；转写文本永久保留，TTL 内可回放语音，过期后语音气泡降级为纯文字气泡

**备选**：
- `public/uploads/audio/` + 无鉴权 —— 被否决，隐私风险（任何人拿到 URL 可播放）
- 对象存储 —— 被否决，过度设计
- base64 存 DB —— 被否决，体积膨胀且查询效率差

**TTL 实现**：文件名编码时间戳（`<timestamp>-<uuid>.webm`），服务端定时任务（Nuxt plugin 或 nitro task）扫描 `server/uploads/audio/`，解析文件名中的时间戳，删除超过 7 天的文件。使用文件名时间戳而非 `mtime`，避免文件系统操作（备份、杀毒扫描）更新 `mtime` 导致文件永不过期。前端回放时若音频 404，降级为纯文字气泡（隐藏播放控件，仅展示转写文本）。

### 决策 3：情感作为系统提示注入，不落库

**选择**：`/api/audio/transcribe` 返回 `{ text, emotion, audioUrl, duration }`。其中 `duration` 由服务端通过 ffprobe/ffmpeg 实测音频时长，不信任前端上报值。前端提交 `/api/chat` 时，body 新增可选 `audio` 字段（含 `url`/`emotion`/`duration`），`emotion` 嵌套在 `audio` 对象内（非顶层字段）；`chat.post.ts` 在**用户位置上下文注入之后**追加情感提示（如「【用户情绪】用户当前情绪可能为<开心>，请适当贴合该情绪回复」），仅注入本次 `streamText` 调用，不写入 `messages` 表。

**emotion 白名单校验（防 prompt 注入）**：`chat.post.ts` 必须用白名单校验 `body.audio.emotion`，仅接受 `'happy' | 'sad' | 'angry' | 'neutral'` 四个值之一，其他值（含 `null`、空串、`"unknown"`、任意攻击字符串）一律忽略不注入。校验实现：

```ts
const ALLOWED_EMOTIONS = new Set(['happy', 'sad', 'angry', 'neutral'])
const emotion = typeof body.audio?.emotion === 'string' && ALLOWED_EMOTIONS.has(body.audio.emotion)
  ? body.audio.emotion
  : null
```

注入位置硬约束：必须位于 `finalSystemPrompt` 拼接的最末位（即 line 469 `if (clientIp)` 分支之后），确保情感提示不被后续任何工具规则冲淡。

**SenseVoice `EMO_UNKNOWN` 标签处理**：SenseVoice 在无法识别情感时会输出 `<|EMO_UNKNOWN|>` 标签（FunASR 源码 `postprocess_utils.py` 中 `emoji_dict` 确认）。`sensevoice.ts` 解析时识别该标签并映射为 `emotion: null`（与其他「无情感」场景一致），不落库为独立状态，不注入 system prompt。

**理由**：
- 用户选择「仅本次对话不落库」。情感是瞬时信号，跨会话保留意义不大且可能引入偏见
- 注入系统提示是最轻量的情感融入方式，无需改 LLM 模型或工具链
- 放在最终 system prompt 最末位，可确保情绪感知不会被任何工具规则或位置上下文冲淡
- 白名单校验防御「客户端伪造 emotion 注入任意文本到 system prompt」的攻击向量

**备选**：情感落库到 `messages.metadata.emotion` —— 被否决，用户明确选择不持久化。

### 决策 4：降级触发基于 SenseVoiceSmall 语种标签，配置化方言集合

**选择**：SenseVoiceSmall 输出含语种标签。当语种标签命中方言集合时，触发 TeleSpeechASR 二次转写，取两者中更优结果（优先 TeleSpeechASR 文本，若为空则回退 SenseVoiceSmall 文本）。

**方言触发集合（环境变量 `DIALECT_LANGUAGE_TAGS`）**：

根据 [FunAudioLLM/SenseVoice 官方 README](https://github.com/FunAudioLLM/SenseVoice) 的 `language` 参数枚举（实测确认），SenseVoice 实际支持的语种标签为：

| 标签 | 含义 | 触发降级？ |
| --- | --- | --- |
| `zh` | 普通话 | ❌ |
| `en` | 英语 | ❌ |
| `yue` | 粤语 | ✅ |
| `ja` | 日语 | ❌（不属方言集合） |
| `ko` | 韩语 | ❌（不属方言集合） |
| `nospeech` | 无语音 | ❌ |

**修正：原提案 `yue,nan,wuu` 默认值错误**。`nan`（闽南语）和 `wuu`（吴语）**不是 SenseVoice 原生输出的语种标签**，即使方言音频被识别也会被归类为 `zh`。正确默认值修正为：

```
DIALECT_LANGUAGE_TAGS=yue
```

> **重要**：上述 6 个标签是 SenseVoice 官方语言参数的全部枚举。若实测发现 SenseVoice 实际输出其他方言标签（如 `nan` 等），通过环境变量扩展。**默认值仅包含 `yue`，保守触发降级**。

**TeleSpeechASR 端点可用性说明（实测发现）**：

SiliconFlow 官方 API 文档（`/api-reference/audio/create-audio-transcriptions`）**仅列出 `FunAudioLLM/SenseVoiceSmall` 一个模型**，未官方列出 `TeleAI/TeleSpeechASR`。第三方资料（CSDN 博客）显示 TeleSpeechASR 确实由硅基流动提供（电信星辰），但**未明确是否通过同一 `/v1/audio/transcriptions` 端点暴露**。

**实现处理**：`server/tools/telespeech.ts` 在调用前必须做端点可用性探测：
1. 先尝试 `POST /v1/audio/transcriptions` 用 `TeleAI/TeleSpeechASR` 模型名调用
2. 若返回 404「model not found」或 400「invalid model」，则**该端点不支持 TeleSpeechASR**，自动降级为「仅 SenseVoiceSmall 单独转写」
3. 探测结果缓存到 `telespeech.ts` 模块级变量（进程内），后续请求直接走缓存结果

这样即使 TeleSpeechASR 在硅基流动下线/迁移，Workflow 也能优雅降级，不影响主功能。

**理由**：
- SenseVoice 官方仅支持 6 个语种（含 1 个无语音），不包含 `nan`/`wuu`
- 端点可用性探测防御 TeleSpeechASR 模型在硅基流动下线/迁移的风险
- 方言集合配置化（环境变量），避免硬编码

**备选**：
- 置信度分数触发 —— 被否决，SenseVoiceSmall 不输出置信度分数
- 总是双模型并发 —— 被否决，成本翻倍、延迟增加

### 决策 5：`messages.metadata` 复用 JSONB，不新增列

**选择**：语音消息的 user 消息落库时，`metadata` 写入 `{ audio: { url, emotion, duration, createdAt } }`，与现有 `{ images }` / `{ model }` 结构并存。不新增 `audio_url` / `emotion` 列。

**`saveMessagesToDb` 签名变更**：

当前 `chat.post.ts` 签名（line 856-862）：
```ts
async function saveMessagesToDb(
  sessionId: string,
  chatMessages: Array<{ role: string; content: unknown }>,
  assistantText: string,
  modelName: string,
  imageUrls?: string[]
)
```

新增 `audio` 参数（位置在 `imageUrls` 之后，保持向后兼容）：
```ts
async function saveMessagesToDb(
  sessionId: string,
  chatMessages: Array<{ role: string; content: unknown }>,
  assistantText: string,
  modelName: string,
  imageUrls?: string[],
  audio?: { url: string; emotion: string | null; duration: number }
)
```

**`audio.emotion` 落库规范化**：
- 服务端接收到的 `body.audio.emotion` 必须经过 `ALLOWED_EMOTIONS` 白名单校验（同决策 3）
- 通过校验的值原样落库到 `metadata.audio.emotion`
- 未通过校验的值（`null`、空串、未知值）落库为 `metadata.audio.emotion: null`
- 前端 `VoiceMessageBubble` 渲染时，`emotion === null` 不展示情感标签

**metadata 合并逻辑**（替换 `chat.post.ts` line 866-869）：
```ts
const meta: Record<string, unknown> = {}
if (imageUrls && imageUrls.length > 0) {
  meta.images = imageUrls.map((url, i) => ({ index: i, url }))
}
if (audio && audio.url) {
  meta.audio = {
    url: audio.url,
    emotion: audio.emotion,  // 已是白名单校验后的值或 null
    duration: audio.duration,
    createdAt: new Date().toISOString()
  }
}
```

`onFinish` 回调传入新增参数（line 550 附近）：
```ts
await saveMessagesToDb(
  sessionId,
  messages,
  cleanText,
  useModel,
  hasImages ? imageUrls : undefined,
  audio  // 新增：从 body 提取的 audio 对象（含 url/emotion/duration）
)
```

`audio` 来源：`chat.post.ts` 顶部 body 解析处（line 267-278 附近）新增：
```ts
const audio: { url: string; emotion: string | null; duration: number } | undefined =
  body?.audio?.url
    ? {
        url: String(body.audio.url),
        emotion: ALLOWED_EMOTIONS.has(body.audio.emotion) ? body.audio.emotion : null,
        duration: Number(body.audio.duration) || 0
      }
    : undefined
```

**理由**：`metadata` 已是 JSONB，灵活扩展无需 Schema 迁移（`pnpm db:push`）。情感虽不作为长期状态注入，但 `audio.emotion` 作为转写时的情感快照保留（供语音气泡展示情感标签），与「情感不落库」不矛盾 —— 这里存的是「这条语音消息识别到的情感」，用于 UI 展示，不用于跨会话记忆。

**澄清**：决策 3「情感不落库」指情感不作为独立的长期情感状态持久化、不注入 system prompt 跨请求复用；决策 5 的 `audio.emotion` 是单条语音消息的元信息快照，随消息本身存在，符合消息不可变约定。

### 决策 6：语音消息走 `/api/chat` 流程，不新建独立消息接口

**选择**：转写文本作为 user 消息的 `content`，`audioUrl`/`emotion` 通过 body 传入 `/api/chat`，`saveMessagesToDb` 落库时写入 `metadata.audio`。AI 回复通过现有 `streamText` 生成。

**理由**：复用现有聊天流程，避免新建独立消息提交接口。语音消息本质是「带音频附件的文本消息」，走 `/api/chat` 自然融入对话上下文。

**备选**：新建 `POST /api/voice-message` 独立接口 —— 被否决，与 `/api/chat` 逻辑重复，维护成本高。

### 决策 7：MediaRecorder API 兼容性与 SSR 水合

**选择**：
- 录音按钮始终渲染（不依赖 `speechSupported`），点击时在事件处理函数内检测 `navigator.mediaDevices?.getUserMedia` 与 `window.MediaRecorder`，不支持则 toast 提示
- `isRecording` ref 初始值 `false`（SSR 安全），MediaRecorder 实例仅在实际录音时创建（事件处理函数内，非 setup 顶层）
- 录音状态、录音时长均用 ref，初始值 SSR 安全

**理由**：
- Web Speech API 按钮用 `speechSupported` 控制渲染（onMounted 赋值），但 MediaRecorder 在现代浏览器与 Android WebView 5.x+ 支持较好，采用「始终渲染 + 运行时检测降级」更友好
- SSR 水合：不在 setup 顶层访问 `navigator`/`window`，所有浏览器 API 调用放在事件处理函数内（用户点击触发，必然在客户端），避免水合不匹配

### 决策 8：录音最大时长限制 60 秒

**选择**：前端录音最大时长 60 秒，超时自动停止录制并 toast 提示「录音已超过 60 秒，已自动停止」。`MAX_RECORDING_DURATION = 60` 作为常量定义在 `ChatInput.vue` 中。

**理由**：防止用户录制过长音频导致文件过大（MediaRecorder WebM/Opus 60 秒约 200-500KB，远低于 10MB 后端校验限制）、转写延迟过高、用户体验差。60 秒覆盖绝大多数语音消息场景（微信语音消息也是 60 秒上限）。

**备选**：不设上限 —— 被否决，用户可能录制数十分钟音频，超过后端 10MB 限制被 400 拒绝，体验更差。

### 决策 9：录音启动并发守卫

**选择**：录音启动函数 `startVoiceRecording` 入口处加 `isStartingRecording` 标志位守卫，阻止 `getUserMedia` 异步等待期间的重复点击。守卫在 `getUserMedia` 成功（进入录音状态）或失败（权限拒绝/不支持）时重置。

**理由**：符合 AGENTS.md「异步写操作必须防重复提交」规则。`getUserMedia` 是异步操作（用户需在浏览器弹窗中点允许/拒绝），在此期间用户可能多次点击按钮，导致多个 `MediaRecorder` 实例并发。标志位守卫是最轻量的防重复方案。

**备选**：按钮 `disabled` 属性 —— 被否决，在 `getUserMedia` pending 期间 `disabled` 对用户无反馈（不知是卡住还是处理中），`isStartingRecording` 配合 loading 视觉反馈更好。

### 决策 10：SenseVoiceSmall 富文本转录解析

**选择**：`server/tools/sensevoice.ts` 在调用 API 后，对返回的 `text` 字段做标签解析，提取并返回结构化数据：`{ text: "<纯文本>", emotion: "<happy|sad|angry|neutral|null>", language: "<zh|en|yue|ja|ko|nospeech>", events: ["APPLAUSE", "BGM", ...] }`。解析使用正则 `/<\|\s*([A-Za-z0-9_]+)\s*\|>/g` 提取所有标签，按类型分类。

**情感标签 Map**（7 种，含 `EMO_UNKNOWN`）：
| 原始标签 | 映射值 | 中文名 | UI 配色 |
|---------|-------|--------|---------|
| `<\|HAPPY\|>` | `happy` | 开心 | 暖黄/橙色 |
| `<\|SAD\|>` | `sad` | 悲伤 | 柔和蓝 |
| `<\|ANGRY\|>` | `angry` | 愤怒 | 柔和红 |
| `<\|NEUTRAL\|>` | `neutral` | 中性 | 灰色 |
| `<\|EMO_UNKNOWN\|>` | `null` | 未知 | 不展示 |
| `<\|FEARFUL\|>` | `null` | （未列入白名单） | 不展示 |
| `<\|DISGUSTED\|>` | `null` | （未列入白名单） | 不展示 |
| `<\|SURPRISED\|>` | `null` | （未列入白名单） | 不展示 |

> **重要**：实测发现 SenseVoice 情感集合可能含 `FEARFUL`/`DISGUSTED`/`SURPRISED` 等扩展标签（FunASR 源码层有定义，但仅 4 种高频）。提案 MVP 阶段仅映射 `HAPPY/SAD/ANGRY/NEUTRAL` 到白名单，其他情感标签（含 `EMO_UNKNOWN`）一律归为 `null`。后续若需扩展，在 `ALLOWED_EMOTIONS` 中追加并更新 UI 配色。

**理由**：API 返回嵌入标签的原始文本，前端需要结构化数据来渲染情感标签 UI 和注入系统提示。服务端解析一次，避免前端重复解析逻辑。

**备注**：若文本中无情感标签或情感标签为 `EMO_UNKNOWN`/`FEARFUL` 等未列入白名单的标签，`emotion` 返回 `null`（非 `"unknown"`），前端不展示情感标签，系统提示不注入情感。

### 决策 11：音频格式 —— 前端 WebM，服务端 ffmpeg 转 WAV

**选择**：前端 MediaRecorder 采集 WebM/Opus → 服务端收到 WebM 后，用 ffmpeg 转码为 WAV（16kHz / 16bit / mono / PCM）→ 送入 ASR API。转码后的 WAV 仅用于 API 调用，不落盘。

**理由**：MediaRecorder 原生支持 WebM/Opus（压缩率高、文件小），不支持 WAV/PCM。WAV 格式已实测确认可用（硅基流动 ASR API 接受 WAV）。WebM 格式支持未经实测确认，但 OpenAI 兼容规范列出 WebM 为支持格式。为保险起见，统一转 WAV 避免格式兼容问题。

**备选**：直接传 WebM 给 ASR API —— 风险中等，未实测确认，若 API 不支持 WebM 需回退方案，不如统一转码。

### 决策 12：语音按钮合并入口

**选择**：将「语音消息」与「Web Speech API 语音输入」合并为一个入口按钮（麦克风图标），点击后展开小菜单供用户选择：
- 「语音消息」：录制完整语音并发送为语音气泡
- 「语音输入」：使用浏览器 SpeechRecognition 实时转写填入输入框

若浏览器不支持 `SpeechRecognition`，菜单中只显示「语音消息」；若不支持 `MediaRecorder` 但支持 `SpeechRecognition`，菜单中只显示「语音输入」。

**理由**：
- 避免输入框两侧各放一个麦克风图标造成混淆
- 不增加输入框宽度压力，左侧仍只保留「图片上传」和「文生图」两个按钮
- 单手操作时入口集中，符合移动端习惯
- 保留两种能力，通过菜单明确区分用途

**备选**：
- 语音消息按钮放在输入框左侧 —— 被否决，左侧已有图片上传、文生图按钮，320px 屏幕下输入框过窄
- 两个语音按钮并排放置 —— 被否决，用户容易混淆两个麦克风图标

### 决策 13：音频文件安全处理

**选择**：服务端收到 WebM 文件后，按以下安全流程处理：
1. **服务端重命名**：忽略客户端上传的原始文件名，统一生成临时文件名 `tmp-<uuid>.webm`，避免文件名注入
2. **ffmpeg 转码**：使用 `child_process.spawn` 数组参数调用，禁止 shell 解析：
   - 输入：`tmp-<uuid>.webm`
   - 输出：`wav-<uuid>.wav`（**每个请求独立 UUID，禁止固定 `output.wav`**，避免并发请求串扰）
   - 参数：`['ffmpeg', '-i', 'tmp-<uuid>.webm', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-map_metadata', '-1', 'wav-<uuid>.wav']`
   - `-map_metadata -1` 清除嵌入元数据，转码过程自然丢弃非音频数据
3. **ffmpeg 重新封装原始 WebM**：`ffmpeg -i tmp-<uuid>.webm -c copy -map_metadata -1 server/uploads/audio/<timestamp>-<uuid>.webm`，确保落盘文件不含恶意元数据
4. **转码后的 WAV 仅用于 API 调用，不落盘；调用结束后立即 `unlinkSync` 清理**
5. **临时文件清理（try/finally）**：整个转写流程（ffmpeg 转码 + ASR 调用）包裹在 `try/finally` 块中，`finally` 阶段无条件清理 `tmp-<uuid>.webm` 和 `wav-<uuid>.wav`（若存在），确保转写失败时临时文件不泄漏

**ffmpeg 跨平台与可用性探测**：

- **可用性探测**：`server/tools/sensevoice.ts` 在首次调用时执行 `spawnSync('ffmpeg', ['-version'])`（**跨平台，无需 `which`**，Node 直接 spawn 可执行文件）
  - 若 `error` 字段非空（命令未找到、ENOENT、超时 5 秒），返回 `{ error: 'ffmpeg_not_found', detail: '服务端未安装 ffmpeg，请联系管理员' }`
  - 探测结果缓存到模块级 `let ffmpegAvailable: boolean | null = null`（进程内），后续请求直接走缓存
- **Windows 兼容**：`spawn('ffmpeg', [...])` 在 Windows 上自动查找 PATH 中的 `ffmpeg.exe`，无需 `cmd /c` 包装（与 `npx` 不同，ffmpeg 是单文件可执行，非 .cmd 脚本）
  - 实测确认：项目本地 ffmpeg 6.1.1（MSYS2 静态构建，target-os=mingw32）通过 `spawn('ffmpeg', ['-version'])` 正常执行
- **PATH 要求**：开发机/部署机需将 ffmpeg 所在目录加入系统 PATH
  - Windows 安装：`winget install ffmpeg` 或 `choco install ffmpeg`，默认安装到 `%LOCALAPPDATA%\Microsoft\WinGet\...`（需手动加 PATH）
  - macOS：`brew install ffmpeg`
  - Linux：`apt-get install ffmpeg`
  - Docker：在 `Dockerfile` 中 `RUN apt-get update && apt-get install -y ffmpeg`（项目当前尚无 Dockerfile，task 0.2 需创建）

**理由**：
- 防止用户上传伪装为 `audio/webm` 的恶意文件（嵌入 JS/HTML 或恶意元数据）
- ffmpeg 转码是天然的安全过滤层（只提取音频流，丢弃其他数据）
- 服务端重命名 + spawn 数组参数 + **每请求独立 UUID 文件名**，可防御命令注入 + 并发串扰
- `spawnSync` 探测 + 模块级缓存避免每次请求都 spawn 一次 `-version`

**备选**：不做处理直接存储 —— 被否决，`public/` 目录通过 Nuxt 静态服务暴露，恶意文件可被直接访问。

## Risks / Trade-offs

- **[风险] MediaRecorder 在低版本 Android WebView 不支持** → 运行时检测降级，不支持时 toast 提示「当前环境不支持语音录制，请使用语音输入或键盘」，引导用户用现有 Web Speech API
- **[风险] SenseVoiceSmall / TeleSpeechASR API 调用失败** → 工具封装返回 `{ error, detail }` 不 throw，Workflow 捕获后返回 500 + 错误信息，前端 toast「转写失败，请重试或手动输入」，不中断聊天主流程
- **[风险] 音频文件 TTL 清理与回放降级的竞态** → 用户回放时恰好文件被清理，前端 `<audio>` 触发 404 事件，降级为纯文字气泡。可接受（TTL 7 天足够长）
- **[风险] 情感识别误判引起用户反感** → 情感标签作为元信息展示，用户可感知；若误判，AI 回复语气可能不合适。缓解：情感提示语用「用户当前情绪可能为<X>」弱化语气，非强制
- **[权衡] TTL 7 天 vs 长期保留** → 7 天平衡磁盘占用与回放需求；转写文本永久保留，核心信息不丢
- **[权衡] 方言降级增加延迟** → 仅方言场景触发双模型，普通话场景单模型 70ms，体验良好；方言场景延迟翻倍可接受
- **[风险] 麦克风权限拒绝** → 复用现有 `useToast` 提示机制，权限拒绝时 toast「麦克风权限被拒绝，请在浏览器设置中允许麦克风访问」
- **[风险] ffmpeg 未安装导致转写失败** → `server/tools/sensevoice.ts` 首次调用前用 `spawnSync('ffmpeg', ['-version'])` 探测（跨平台，无需 `which`），未安装时返回明确错误 `{ error: 'ffmpeg_not_found', detail: '服务端未安装 ffmpeg，请联系管理员' }`；探测结果模块级缓存，避免重复探测。Docker 部署在 Dockerfile 中预装
- **[风险] 并发转写请求 ffmpeg 输出文件串扰** → ffmpeg 输入/输出文件名必须每请求独立 UUID（`tmp-<uuid>.webm` / `wav-<uuid>.wav`），禁止固定 `output.wav`（详见决策 13）
- **[风险] 语音消息按钮与现有 Web Speech API 按钮混淆** → 决策 12 改为合并入口：一个麦克风按钮点击后展开菜单，分别选择「语音消息」或「语音输入」，从根本上消除两个麦克风图标并列的混淆
- **[风险] 部署到 Vercel/Serverless 平台时本地存储不可用** → `server/uploads/audio/` 依赖可写文件系统，仅适用本地/Docker 部署。项目根目录存在 `vercel.json`，若未来上 Vercel 需迁移至对象存储（COS/OSS）。本阶段在 `design.md` 中明确该限制，路由层检测到 `process.env.VERCEL` 时返回清晰错误
- **[风险] 方言标签默认值未经验证导致 TeleSpeechASR 无法触发** → 默认值修正为 `yue`（仅），实施前必须用真实粤语样本调用 SenseVoiceSmall 验证实际输出标签，确认后通过环境变量扩展其他语种
- **[风险] ffmpeg 命令注入** → 通过服务端重命名临时文件 + `child_process.spawn` 数组参数 + 每请求独立 UUID 文件名防御，不直接使用客户端上传文件名拼接 shell 命令
- **[风险·实测新增] TeleSpeechASR 端点可能在硅基流动 `/v1/audio/transcriptions` 不可用** → SiliconFlow 官方 API 文档**未列出**该模型。`telespeech.ts` 首次调用前用最小音频样本探测端点，失败则自动降级为「仅 SenseVoiceSmall 单独转写」，探测结果进程内缓存
- **[风险·实测新增] emotion 字段被恶意客户端用于 prompt 注入** → `chat.post.ts` 必须用 `ALLOWED_EMOTIONS` 白名单校验（决策 3），未通过校验的值不注入 system prompt
- **[风险·实测新增] emotion 注入位置不当被工具规则冲淡** → 注入位置硬约束为 `finalSystemPrompt` 最末位（line 469 之后），被现有所有工具规则和位置上下文覆盖
- **[风险·实测新增] ffmpeg 在不同平台 PATH 查找行为差异** → Windows 上 `spawn('ffmpeg', [...])` 需 ffmpeg.exe 在 PATH 中。开发机实测 6.1.1（MSYS2 mingw32 静态构建）可用；macOS/Linux 需 `brew install ffmpeg` / `apt-get install ffmpeg`。Dockerfile 必须在 `apt-get install -y ffmpeg` 后**显式验证** `ffmpeg -version` 可执行

## Migration Plan

1. 新增 `server/tools/sensevoice.ts`、`server/tools/telespeech.ts` 模型调用封装
2. 新增 `server/api/audio/transcribe.post.ts` 路由（含参数校验、错误处理）
3. 新增音频 TTL 清理逻辑（Nuxt server plugin 或 nitro task）
4. `chat.post.ts` 扩展：接收 `emotion` body 字段，注入系统提示；`saveMessagesToDb` 扩展 `metadata.audio` 写入
5. `ChatInput.vue` 改造语音入口：将原有 Web Speech API 按钮与新增语音消息录音能力合并为一个麦克风入口菜单，菜单内根据浏览器支持情况显示「语音消息」和/或「语音输入」选项
6. 新增语音气泡组件（转文字折叠 + 情感标签 + 音频播放）
7. `ai-chat.vue` 接入语音消息提交流程（转写 → 填充 content + metadata → 提交 `/api/chat`）
8. 更新 `docs/API.md`（新增 `/api/audio/transcribe` 接口）、`docs/db-schema.md`（`metadata.audio` 结构）
9. 回滚策略：语音消息按钮可独立禁用（feature flag 或直接移除按钮），不影响现有聊天流程；ASR 路由失败不影响文本聊天

## Open Questions

- ~~SenseVoiceSmall / TeleSpeechASR 的具体 API 端点与认证方式~~ → **部分确认**：
  - SenseVoiceSmall ✅ `/v1/audio/transcriptions` 端点 + `multipart/form-data`（file + model） + 响应 `{ text }` 已通过 SiliconFlow 官方 API 文档确认
  - TeleSpeechASR ⚠️ 模型名 `TeleAI/TeleSpeechASR` 来自第三方资料（CSDN），SiliconFlow 官方 API 文档**未列出**该模型。Workflow 需做端点可用性探测（详见决策 4）
- ~~音频格式选择~~ → **已确认**：前端 WebM → 服务端 ffmpeg 转 WAV（16kHz/16bit/mono/PCM）→ 送入 ASR API。WAV 格式已实测确认 ffmpeg 可生成（ffmpeg 6.1.1 已启用 matroska demuxer + opus decoder）
- ~~方言触发默认值~~ → **已修正**：`DIALECT_LANGUAGE_TAGS` 默认值从 `yue,nan,wuu` 修正为 `yue`。`nan`/`wuu` 不是 SenseVoice 官方枚举的语种标签（官方仅 zh/en/yue/ja/ko/nospeech 6 种）
- 音频 TTL 清理的实现方式：Nuxt server plugin（`setInterval` 定时器）vs nitro task（需配置）—— 实现时择优。推荐 Nuxt server plugin（项目已有 `server/plugins/` 目录，简单可靠）
- 语音消息气泡的「转文字」折叠面板默认展开还是折叠？倾向默认折叠（语音优先），用户点击展开转写文本 —— 实现时按 UX 微调
- 部署兼容性：`server/uploads/audio/` 本地存储方案在 Vercel 等 Serverless 平台运行时只读，仅适用本地/Docker 部署（项目当前部署模式）。若未来部署到 Vercel，需迁移到对象存储（COS/OSS）或挂载可写卷—— 当前非阻塞，按本地部署假设推进。路由层需检测 `process.env.VERCEL` 并返回明确错误
- ffmpeg 依赖：服务端需安装 ffmpeg + ffprobe 命令行工具。Docker 部署时在 Dockerfile 中 `apt-get install -y ffmpeg`；本地开发需开发机安装 ffmpeg 并加入 PATH。此为新增的系统依赖，需在 `.env.example` 和部署文档中注明。注意：项目中尚无 `Dockerfile`，若容器化部署需先创建该文件
- **新增（2026-07-29 实测发现）**：TeleSpeechASR 端点可用性需实施前实测。`server/tools/telespeech.ts` 实现中必须在首次调用前用一个最小音频样本探测 `POST /v1/audio/transcriptions model=TeleAI/TeleSpeechASR`，根据响应（成功/404/400）决定是否启用 TeleSpeechASR 路径，结果缓存到模块级变量
- **新增（2026-07-29 实测发现）**：SenseVoice 富文本标签中 `EMO_UNKNOWN`（大写）与其他情感标签大小写一致，但部分旧文档误写为 `emo_unk`（小写）。正则解析需同时覆盖大小写，`sensevoice.ts` 解析逻辑需明确处理 `EMO_UNKNOWN` → `null` 映射
