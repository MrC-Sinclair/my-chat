## ADDED Requirements

### Requirement: 语音消息通过 /api/chat 流程持久化

语音消息 SHALL 复用现有 `POST /api/chat` 接口提交，不新建独立消息接口。前端在 `/api/audio/transcribe` 转写成功后，将转写文本作为 user 消息的 `content`，音频元信息（`audioUrl`/`emotion`/`duration`）通过 `/api/chat` 请求 body 的 `audio` 字段携带。其中 `duration` 由 `/api/audio/transcribe` 服务端通过 ffprobe/ffmpeg 实测，不信任前端上报值。`chat.post.ts` 的 `saveMessagesToDb` 在 `onFinish` 回调中落库时，将 `audio` 字段写入 `messages.metadata.audio`（遵循 database-schema spec 的 metadata 写入规则）。AI 回复通过现有 `streamText` 生成并落库，流程不变。

#### Scenario: 语音消息 user 消息落库含 audio metadata

- **WHEN** 前端通过 `/api/chat` 提交语音消息，body 含 `content: "<转写文本>"` 与 `audio: { url, emotion, duration }`
- **THEN** `streamText` 完成后 `onFinish` 回调触发 `saveMessagesToDb`
- **AND** user 消息记录的 `metadata` 写入 `{ audio: { url, emotion, duration, createdAt: "<当前ISO>" } }`
- **AND** `content` 字段存储转写文本
- **AND** assistant 消息正常落库（`metadata: { model }`）

#### Scenario: 语音消息的 emotion 注入系统提示但不落库为独立字段

- **WHEN** `/api/chat` 请求 body 携带 `audio.emotion`
- **THEN** `chat.post.ts` 在最终 `finalSystemPrompt` 末尾追加情感提示语注入 `streamText`
- **AND** 情感信息不作为 `messages` 表的独立列持久化（仅存在于 `metadata.audio.emotion` 快照中）
- **AND** 不影响 `memory_vectors` 归档逻辑（情感不作为跨会话记忆）

### Requirement: 语音消息读取与 TTL 过期回放降级

系统 SHALL 在读取消息列表时，对语音消息（`metadata.audio` 存在）渲染语音气泡。前端在用户点击播放控件时，若音频 URL 返回 404（文件被 TTL 清理），MUST 静默降级为纯文字气泡（隐藏播放控件，展开转文字面板），不显示错误 toast。此降级逻辑在前端处理，不涉及后端接口变更。

#### Scenario: 语音消息正常渲染气泡与播放控件

- **WHEN** 前端读取消息列表，某 user 消息 `metadata.audio` 存在且音频文件未过期
- **THEN** 渲染语音气泡（播放控件 + 情感标签 + 转文字折叠面板）
- **AND** 用户可点击播放控件回放音频

#### Scenario: TTL 过期后回放降级为文字气泡

- **WHEN** 用户点击语音气泡播放控件，音频 URL 返回 404
- **THEN** 隐藏播放控件
- **AND** 自动展开「转文字」折叠面板展示转写文本
- **AND** 不显示错误 toast（静默降级）
- **AND** 情感标签保留展示（来自 `metadata.audio.emotion` 快照）
