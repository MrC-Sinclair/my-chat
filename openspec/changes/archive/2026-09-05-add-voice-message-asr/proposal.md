## Why

当前应用仅支持文本与图片输入，移动端及不便打字场景下表达效率低。现有 Web Speech API 语音输入依赖浏览器原生能力，Android WebView 兼容性差、无法识别情感，且转写结果直接填入输入框，缺少「语音消息」这一更自然的交互形态。引入服务端 ASR（SenseVoiceSmall 主力 + TeleSpeechASR 方言补强）可解决兼容性问题，额外获取的情感信号还能让 AI 回复贴合用户情绪，提升对话体验与移动端输入效率。

## What Changes

- 前端 `ChatInput.vue` 改造语音入口：将原有 Web Speech API 语音输入按钮与新增「语音消息」录音能力合并为一个麦克风入口菜单，菜单根据浏览器能力显示「语音消息」（MediaRecorder API 采集 WebM）和/或「语音输入」选项，触摸目标 ≥ 44px，录音状态有视觉反馈
- 新增服务端 ASR 转写路由 `server/api/audio/transcribe.post.ts`，走 Workflow 预编排：先调 SenseVoiceSmall 拿「文本 + 情感 + 语种 + 事件」，检测到方言语种标签时调 TeleSpeechASR 二次转写取更优结果
- 新增 `server/tools/sensevoice.ts`、`server/tools/telespeech.ts` 两个模型调用封装，失败返回 `{ error, detail }` 不 throw（由 Workflow 决定降级，非 LLM 决策）
- 音频文件存 `server/uploads/audio/`（不对外暴露），通过 API 路由 `/api/audio/:id` 代理访问（路由内校验 session 权限），设 TTL 自动清理防止磁盘膨胀；转写文本永久保留，TTL 内可回放，过期后语音气泡降级为纯文字气泡
- 语音消息以气泡形式展示，附带「转文字」折叠面板与情感标签（开心/愤怒/疑惑等）元信息
- 将 SenseVoiceSmall 识别到的情感作为系统提示注入 `streamText` 上下文，让 AI 情绪化回复（情感仅本次对话，不落库）
- `messages` 表复用 `metadata` JSONB 字段存音频快照（`{ audio: { url, emotion, duration, createdAt } }`），不新增列
- 录音需麦克风授权，权限拒绝时用 `useToast` 提示；转写失败降级提示「请重试或手动输入」
- **非目标**：不做 TTS（硅基流动免费清单无 TTS 模型）；不替换现有 Web Speech API 语音输入；不做实时流式 ASR

## Capabilities

### New Capabilities

- `voice-message-asr`: 语音消息录制（MediaRecorder）、服务端 ASR 转写（SenseVoiceSmall + TeleSpeechASR 语种触发降级）、情感识别、情绪化系统提示注入、音频本地存储与 TTL 自动清理、语音气泡 UI（转文字折叠面板 + 情感标签）

### Modified Capabilities

- `chat-input`: 将原有 Web Speech API 语音输入按钮改造为统一语音入口菜单，新增「语音消息」录音选项，录音状态视觉反馈，麦克风权限拒绝处理
- `database-schema`: `messages.metadata` JSONB 字段新增 `audio: { url, emotion, duration, createdAt }` 嵌套结构（不新增列，复用 metadata）
- `messages-api`: 语音消息的持久化与读取逻辑（音频 URL + 转写文本同消息落库，TTL 过期回放降级）

## Impact

| 层级 | 影响 |
|---|---|
| 前端 | `ChatInput.vue` 改造为统一语音入口菜单（合并 Web Speech API 语音输入与新增语音消息录音）；新增语音气泡组件（转文字折叠 + 情感标签）；`ai-chat.vue` 接入语音消息提交流程 |
| 后端 | 新增 `server/api/audio/transcribe.post.ts`（ASR Workflow）；新增 `server/tools/sensevoice.ts`、`server/tools/telespeech.ts`；`server/api/chat.post.ts` 注入情感系统提示；新增音频存储（`server/uploads/audio/`）+ API 代理路由（`/api/audio/:id`）+ TTL 清理任务 |
| 数据库 | `messages.metadata` JSONB 新增 `audio: { url, emotion, duration, createdAt }` 嵌套字段（无需 Schema 迁移，JSONB 灵活）；需更新 `docs/db-schema.md` |
| 依赖 | 新增 SenseVoiceSmall / TeleSpeechASR 模型 API 调用（通过硅基流动或对应平台）；新增 ffmpeg 系统依赖（音频转码与安全处理）
| 文档 | `docs/API.md` 新增 `/api/audio/transcribe` 接口；`docs/db-schema.md` 更新 `messages.metadata` 结构 |
