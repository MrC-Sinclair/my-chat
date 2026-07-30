## MODIFIED Requirements

### Requirement: messages.metadata JSONB 字段

`messages` 表的 `metadata` 列 MUST 为 JSONB 类型，可空，用于存储消息的附加元数据。`saveMessagesToDb` SHALL 按以下规则写入 metadata：
- **用户消息**：若携带图片，写入 `{ images: [{ index: number, url: string }, ...] }`；若为语音消息，写入 `{ audio: { url: string, emotion: string, duration: number, createdAt: string } }`；同时携带图片与音频时合并为 `{ images: [...], audio: {...} }`；无图片且无音频时 metadata 为 `undefined`（不写入该列）
- **AI 消息**：写入 `{ model: "<模型名称>" }`，如 `{ model: "Qwen/Qwen3-8B" }`

`audio.url` 为 API 代理路由 URL（如 `/api/audio/<uuid>`，路由内校验 session 权限），音频文件实际存储在 `server/uploads/audio/<timestamp>-<uuid>.webm`（不对外暴露）。`audio.emotion` 为 SenseVoiceSmall 识别的情感快照（供 UI 展示情感标签，非跨会话长期情感状态）。`audio.emotion` 在落库前 MUST 经 `ALLOWED_EMOTIONS = new Set(['happy', 'sad', 'angry', 'neutral'])` 白名单校验（防 prompt 注入），未通过校验的值（包括 `null`、空串、`"unknown"`、`"EMO_UNKNOWN"`、任意攻击字符串）一律落库为 `null`。`audio.duration` 为录音时长（秒），`audio.createdAt` 为音频创建时间（ISO 字符串，用于 TTL 清理判断）。`audio.emotion` 与决策 3「情感不落库」不冲突：此处存的是单条语音消息的元信息快照，随消息本身存在且不可变，不作为独立的长期情感状态持久化。

#### Scenario: 用户消息附带图片时写入 images 数组

- **WHEN** 用户上传图片并发送消息，`saveMessagesToDb` 收到 `imageUrls` 参数非空
- **THEN** 用户消息记录的 `metadata` 写入 `{ images: [{ index: 0, url: "..." }, { index: 1, url: "..." }] }`
- **AND** 图片 URL 为 ImgBB 上传后的公网 URL

#### Scenario: 用户消息为语音消息时写入 audio 对象

- **WHEN** 用户发送语音消息，`saveMessagesToDb` 收到 `audio` 参数（含 url/emotion/duration/createdAt）
- **THEN** 用户消息记录的 `metadata` 写入 `{ audio: { url: "/api/audio/<uuid>", emotion: "happy", duration: 5, createdAt: "<ISO>" } }`
- **AND** `content` 字段存储转写文本（非音频数据）

#### Scenario: AI 消息写入使用的模型名

- **WHEN** `saveMessagesToDb` 插入 AI 回复记录
- **THEN** `metadata` 写入 `{ model: modelName }`
- **AND** modelName 来自请求参数，用于后续追溯每条 AI 回复使用的模型

#### Scenario: 纯文本用户消息不写 metadata

- **WHEN** 用户消息无图片附件且无语音附件
- **THEN** 用户消息记录的 `metadata` 为 `undefined`（数据库存储 NULL）
- **AND** 不写入空对象 `{}`

#### Scenario: 语音消息的 audio.emotion 不作为跨会话情感状态

- **WHEN** 会话切换触发长期记忆归档（`archiveSessionMessages`）
- **THEN** 语音消息的 `audio.emotion` 不被提取为独立的情感状态写入 `memory_vectors`
- **AND** `audio.emotion` 仅作为该条消息的元信息随消息文本一起参与归档（若文本被判定为重要记忆）

#### Scenario: audio.emotion 落库前经白名单校验

- **WHEN** `saveMessagesToDb` 收到 `audio.emotion` 为 `"happy"`/`"sad"`/`"angry"`/`"neutral"` 之一
- **THEN** 通过 `ALLOWED_EMOTIONS` 白名单校验，原样写入 `metadata.audio.emotion`

- **WHEN** `saveMessagesToDb` 收到 `audio.emotion` 为其他值（`null`、空串、`"unknown"`、`"EMO_UNKNOWN"`、任意攻击字符串）
- **THEN** **不**写入原始值，落库为 `metadata.audio.emotion: null`
