## 0. 环境准备

- [x] 0.1 本地开发机安装 ffmpeg（`winget install ffmpeg` 或 `choco install ffmpeg`），验证 `ffmpeg -version` 可用；Windows 安装后需将 ffmpeg 所在目录加入系统 PATH（默认安装路径 `%LOCALAPPDATA%\Microsoft\WinGet\...` 需手动加 PATH），否则 `spawn('ffmpeg', [...])` 会因 ENOENT 失败
- [x] 0.2 若使用 Docker 部署，创建/更新 Dockerfile 并新增 `RUN apt-get update && apt-get install -y ffmpeg`；**显式验证** `ffmpeg -version` 在容器内可执行（避免基础镜像缺少 libopus 等导致 spawnSync 探测通过但实际转码失败）；注意项目当前尚无 Dockerfile，容器化部署需先创建该文件
- [x] 0.3 更新 `.env.example` 添加 `DIALECT_LANGUAGE_TAGS` 环境变量，**默认值修正为 `yue`**（仅粤语，详见 design.md 决策 4 实测发现）。`nan`（闽南语）/`wuu`（吴语）**不是 SenseVoice 官方枚举的语种标签**（官方仅 zh/en/yue/ja/ko/nospeech 6 种），原提案默认值错误；扩展其他方言需先用真实方言样本实测 SenseVoiceSmall 输出标签后通过环境变量配置
- [x] 0.4 在 `server/tools/sensevoice.ts` 实现 `ffmpeg` 可用性探测函数（`spawnSync('ffmpeg', ['-version'])` 跨平台探测，错误返回 `ffmpeg_not_found`），探测结果模块级缓存避免每次请求重复探测
- [x] 0.5 **ffprobe 依赖明确化**：ffprobe 与 ffmpeg 同源安装（同一安装包），用于服务端实测音频时长（秒数），不信任前端上报值。在 `server/api/audio/transcribe.post.ts` 中通过 `spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '<audio-file>'])` 获取音频时长（秒）。若 ffprobe 不可用，降级使用 ffmpeg 的 `-show_entries format=duration` 参数或从文件元数据估算。探测结果同样模块级缓存

## 1. 服务端 ASR 模型封装

- [x] 1.1 新增 `server/tools/sensevoice.ts`，封装 FunAudioLLM/SenseVoiceSmall 模型调用，输入音频文件路径，调用 `/v1/audio/transcriptions`，解析返回的富文本标签，输出 `{ text, emotion, language, events }`；标签提取统一使用 `/<\|\s*([A-Za-z0-9_]+)\s*\|>/g`（情感/语种/事件标签大小写均可匹配），纯文本清洗使用 `/<\|[^|]+\|>/g`；调用失败返回 `{ error, detail }` 不 throw
- [x] 1.2 新增 `server/tools/telespeech.ts`，封装 TeleAI/TeleSpeechASR 模型调用，输入音频文件路径，输出 `{ text }`；调用失败返回 `{ error, detail }` 不 throw
- [x] 1.3 为两个工具封装编写单元测试（mock 模型 API，验证成功返回结构与失败返回 `{ error, detail }` 不 throw）
- [x] 1.4 运行 `pnpm lint` + `pnpm typecheck` 验证无错误

## 2. 服务端 ASR 转写路由与音频存储

- [x] 2.1 新增 `server/api/audio/transcribe.post.ts` 路由，接收音频文件（multipart/form-data），用 zod 校验文件大小（≤10MB）与 MIME 类型（`audio/*`），校验失败 `createError({ statusCode: 400 })`
- [x] 2.2 路由内 WebM 转 WAV：服务端先重命名为 `tmp-<uuid>.webm`，使用 `child_process.spawn` 数组参数调用 ffmpeg：`ffmpeg -i tmp-<uuid>.webm -acodec pcm_s16le -ar 16000 -ac 1 -map_metadata -1 wav-<uuid>.wav`（16kHz/16bit/mono/PCM + 清除元数据）。**关键**：输入/输出文件名均使用每请求独立 UUID（`tmp-<uuid>.webm` / `wav-<uuid>.wav`），**禁止固定文件名**（如 `output.wav`），防止并发请求串扰。WAV 仅用于 API 调用不落盘；ffmpeg 未安装时（探测函数返回 false）返回 `{ error: 'ffmpeg_not_found', detail: '服务端未安装 ffmpeg，请联系管理员' }`
- [x] 2.3 路由内音频安全处理：原始 WebM 落盘前经 ffmpeg 重新封装 `ffmpeg -i tmp-<uuid>.webm -c copy -map_metadata -1 server/uploads/audio/<timestamp>-<uuid>.webm` 清除嵌入元数据；全程不直接使用客户端上传文件名，防御命令注入
- [x] 2.4 路由内 Workflow 预编排：调 SenseVoiceSmall → 使用 `/<\|\s*([A-Za-z0-9_]+)\s*\|>/g` 提取标签 → 检测语种标签命中 `DIALECT_LANGUAGE_TAGS` 方言集合（**默认 `yue`**，仅粤语）时调 TeleSpeechASR 补强（取更优结果，TeleSpeechASR 失败降级回 SenseVoiceSmall）→ 通过 ffprobe/ffmpeg 实测音频时长 → 返回 `{ text, emotion, audioUrl, duration }`
- [x] 2.4.1 `server/tools/telespeech.ts` 在首次调用前必须用最小音频样本探测 `POST /v1/audio/transcriptions model=TeleAI/TeleSpeechASR` 端点可用性（**SiliconFlow 官方 API 文档未列出该模型**，详见 design.md 决策 4 实测发现）。探测结果（true/false）缓存到模块级 `let teleSpeechAvailable: boolean | null = null`，避免每次请求重复探测。探测失败则该请求路径**自动降级为仅 SenseVoiceSmall 单独转写**，不报错、不影响主流程
- [x] 2.5 模型调用失败时 `createError({ statusCode: 500, statusMessage: '语音转写失败，请重试' })`，`console.error` 记录原始错误，响应不暴露堆栈
- [x] 2.6 新增音频 TTL 清理逻辑（Nuxt server plugin 用 `setInterval` 定时器），扫描 `server/uploads/audio/`，解析文件名中的时间戳，删除超过 7 天的文件（使用文件名时间戳而非 `mtime`）
- [x] 2.7 运行 `pnpm lint` + `pnpm typecheck` 验证无错误

## 3. chat.post.ts 扩展（情感注入 + metadata.audio）

- [x] 3.1 `server/api/chat.post.ts` 请求 body 新增可选 `audio` 字段（含 `url`/`emotion`/`duration`）。**emotion 白名单校验（防 prompt 注入）**：使用 `ALLOWED_EMOTIONS = new Set(['happy', 'sad', 'angry', 'neutral'])` 校验 `body.audio.emotion`，未通过校验的值（`null`/空串/`"unknown"`/任意攻击字符串）一律忽略不注入。**注入位置硬约束**：必须在 `finalSystemPrompt` 拼接的**最末位**追加情感提示语（即 line 469 `if (clientIp)` 分支之后），弱化语气「用户当前情绪可能为<开心>，请适当贴合该情绪回复」，仅注入本次 `streamText`，不写入 `messages` 表
- [x] 3.2 `server/api/chat.post.ts` 请求 body 的 `audio` 字段（含 `url`/`emotion`/`duration`）处理。**`saveMessagesToDb` 签名变更（决策 5）**：在原 `imageUrls` 参数后追加 `audio?: { url: string; emotion: string | null; duration: number }`，保持向后兼容。`saveMessagesToDb` 落库 user 消息时按以下规则合并 metadata：
  - 若 `imageUrls` 非空 → `meta.images = imageUrls.map((url, i) => ({ index: i, url }))`
  - 若 `audio?.url` 非空 → `meta.audio = { url, emotion, duration, createdAt: new Date().toISOString() }`
  - 同时存在 → `{ images: [...], audio: {...} }`
  - 都不存在 → metadata 为 `undefined`（不写入该列）
  - `audio.emotion` 落库前**必须经 `ALLOWED_EMOTIONS` 白名单校验**（同 3.1），未通过校验落库为 `null`
- [x] 3.3 `onFinish` 回调调用 `saveMessagesToDb` 时传入新增的 `audio` 参数（从 `body.audio` 提取并经白名单校验后的对象）
- [x] 3.4 运行 `pnpm typecheck` 验证类型安全
- [x] 3.5 运行 `pnpm test:unit` 验证现有聊天逻辑未回归

## 4. 前端 ChatInput 语音入口改造

- [x] 4.1 `components/chat/ChatInput.vue` 将原有 Web Speech API 语音输入按钮改造为统一语音入口按钮（麦克风图标），点击后展开菜单：
  - 浏览器支持 `MediaRecorder` 时显示「语音消息」选项
  - 浏览器支持 `SpeechRecognition` 时显示「语音输入」选项
  - 仅支持一种能力时菜单只显示对应选项；两种都不支持时按钮不渲染或禁用并 toast 提示
  - 入口按钮手机端 `min-w-[44px] min-h-[44px]`，平板端 `sm:min-w-[40px] sm:min-h-[40px]`，使用 `v-tooltip` 提示
- [x] 4.2 实现语音消息录音逻辑：`MAX_RECORDING_DURATION = 60` 秒上限，超时自动 `mediaRecorder.stop()` + toast 提示；`isStartingRecording` 标志位守卫防止 `getUserMedia` 期间的并发点击；所有浏览器 API 在事件处理函数内调用（SSR 安全）
- [x] 4.3 录音状态视觉反馈：红色脉冲动画 + 时长计时（`mm:ss`），`isStartingRecording` 期间显示 loading 状态；录音中再次点击停止录制；停止后自动上传
- [x] 4.4 录音结束生成 WebM Blob，自动 `$fetch` 上传到 `/api/audio/transcribe`（FormData），上传中显示 loading + 禁用按钮，转写成功 emit 结果给父组件
- [x] 4.5 浏览器不支持 `MediaRecorder` 时菜单中隐藏「语音消息」选项（或 toast「当前环境不支持语音录制」）；麦克风权限拒绝（`NotAllowedError`）时 toast「麦克风权限被拒绝」；AI 回复期间禁用语音入口按钮
- [x] 4.6 运行 `pnpm lint` + `pnpm typecheck` 验证无错误

## 5. 前端语音气泡组件

- [x] 5.1 新增 `components/chat/VoiceMessageBubble.vue`，展示音频播放控件（播放/暂停 + 进度条 + 时长）、情感标签（柔和配色：暖黄/橙色=开心，柔和蓝=悲伤，柔和红=愤怒，灰色=中性）、「转文字」折叠面板（默认折叠，`max-height` + `transition` 平滑展开，禁止 `v-if` 硬切）
- [x] 5.2 实现 `<audio>` 播放逻辑，音频 URL 返回 404 时静默降级（隐藏播放控件 + 自动展开转文字面板），不显示错误 toast；情感标签保留展示
- [x] 5.3 气泡宽度遵循 `max-w-[92%] sm:max-w-[85%]`，移动端播放控件与情感标签不溢出
- [x] 5.4 运行 `pnpm lint` + `pnpm typecheck` 验证无错误

## 6. ai-chat.vue 接入语音消息流程

- [x] 6.1 `pages/ai-chat.vue` 接收 ChatInput 的语音转写结果，将转写文本作为 `input` content，`audioUrl`/`emotion`/`duration` 作为提交 `/api/chat` 的额外 body 字段
- [x] 6.2 消息列表渲染时，对 `metadata.audio` 存在的 user 消息使用 `VoiceMessageBubble` 组件渲染（替代普通文本气泡），其他消息不变
- [x] 6.3 验证虚拟滚动（`@tanstack/vue-virtual`）与语音气泡兼容，语音气泡高度变化不影响虚拟列表定位（禁止 `<TransitionGroup>` 包裹虚拟滚动）
- [x] 6.4 运行 `pnpm lint` + `pnpm typecheck` 验证无错误

## 7. 文档更新

- [x] 7.1 更新 `docs/API.md`，新增 `POST /api/audio/transcribe` 接口定义（请求体、响应体、错误码 400/500、Workflow 路径说明、ffmpeg 依赖要求）
- [x] 7.2 更新 `docs/db-schema.md`，`messages.metadata` JSONB 结构新增 `audio: { url, emotion, duration, createdAt }` 字段说明
- [x] 7.3 更新 `docs/API.md` 中 `/api/chat` 接口，新增 `emotion` 和 `audio` 可选 body 字段说明

## 8. 集成验证

- [x] 8.1 运行 `pnpm lint` 全项目无 lint 错误
- [x] 8.2 运行 `pnpm typecheck` 类型检查通过
- [x] 8.3 运行 `pnpm test:unit` 单元测试通过（新增 ASR 工具封装测试 + 现有测试无回归）
- [ ] 8.4 `pnpm dev` 启动后浏览器实测：录音按钮触摸目标 ≥ 44px、录音脉冲动画、60 秒自动停止、并发守卫防重复点击、转写成功生成语音气泡、情感标签展示、转文字折叠展开、音频回放、TTL 过期降级（手动删除音频文件验证 404 降级）
- [ ] 8.5 移动端实测（Android WebView 或 Chrome DevTools 移动端模拟）：录音按钮可达、麦克风权限拒绝 toast、语音气泡不溢出
- [ ] 8.6 方言场景实测（如有方言音频样本）：验证 SenseVoiceSmall 检测方言语种标签触发 TeleSpeechASR 补强