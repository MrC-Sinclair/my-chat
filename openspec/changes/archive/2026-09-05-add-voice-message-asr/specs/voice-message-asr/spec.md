## ADDED Requirements

### Requirement: 语音消息录制（MediaRecorder）

系统 SHALL 在 ChatInput 语音入口菜单中提供「语音消息」选项，使用浏览器原生 `MediaRecorder` API 采集用户语音为 WebM 格式。语音入口按钮手机端触摸目标 MUST ≥ 44px，平板端（`sm:`）可缩至 40px。入口菜单根据浏览器能力动态显示「语音消息」和/或「语音输入」选项。所有浏览器 API（`navigator.mediaDevices`、`window.MediaRecorder`）调用 MUST 在事件处理函数内执行（用户点击触发，必然在客户端），禁止在 setup 顶层或 SSR 期间访问，避免水合不匹配。

#### Scenario: 用户点击录音按钮开始录制

- **WHEN** 用户在语音入口菜单中选择「语音消息」且浏览器支持 `MediaRecorder`
- **THEN** 系统调用 `navigator.mediaDevices.getUserMedia({ audio: true })` 请求麦克风权限
- **AND** 权限授予后创建 `MediaRecorder` 实例开始采集音频
- **AND** 入口按钮变为录音中状态（红色脉冲动画），显示录音时长计时

#### Scenario: 用户点击停止按钮结束录制

- **WHEN** 用户在录音中状态再次点击入口按钮
- **THEN** 系统调用 `mediaRecorder.stop()` 结束采集
- **AND** 释放麦克风 `MediaStream` 资源
- **AND** 生成 WebM 音频 Blob 并自动上传到 `/api/audio/transcribe` 转写

#### Scenario: 浏览器不支持 MediaRecorder

- **WHEN** 用户在语音入口菜单中选择「语音消息」但 `window.MediaRecorder` 或 `navigator.mediaDevices` 不存在
- **THEN** 系统通过 `useToast` 显示错误提示「当前环境不支持语音录制，请使用语音输入或键盘」
- **AND** 不进入录音状态
- **AND** 菜单中隐藏或禁用「语音消息」选项

#### Scenario: 麦克风权限被拒绝

- **WHEN** `getUserMedia` 抛出 `NotAllowedError`（用户拒绝授权或浏览器禁用麦克风）
- **THEN** 系统通过 `useToast` 显示错误提示「麦克风权限被拒绝，请在浏览器设置中允许麦克风访问」
- **AND** 按钮恢复待机状态

#### Scenario: AI 回复期间禁用语音消息按钮

- **WHEN** AI 正在流式回复（`isLoading` 为 true）
- **THEN** 语音入口按钮显示为灰色禁用状态
- **AND** 点击无响应

### Requirement: POST /api/audio/transcribe 接口（ASR Workflow）

系统 SHALL 暴露 `POST /api/audio/transcribe` HTTP 接口，接收前端上传的音频文件，通过 Workflow 预编排流程（先 SenseVoiceSmall，检测到方言语种标签时调 TeleSpeechASR 补强）返回转写文本、情感、音频 URL。此接口为 Workflow 路径（代码预编排），不调用 `streamText`、不注册 `tools`、不由 LLM 决策。接口 MUST 包含参数校验和 `createError()` 错误处理。修改入参/返回值/业务逻辑后必须同步更新 `docs/API.md`。

#### Scenario: 普通话语音转写成功

- **WHEN** 前端上传合法 WebM 音频文件，SenseVoiceSmall 转写成功且语种标签为标准普通话 `zh`
- **THEN** 接口返回 HTTP 200，body 为 `{ text: "<转写文本>", emotion: "<情感标签>", audioUrl: "/api/audio/<uuid>", duration: <秒数> }`（音频文件实际存储于 `server/uploads/audio/<timestamp>-<uuid>.webm`，通过 API 路由代理访问并校验 session 权限）
- **AND** 不调用 TeleSpeechASR（无需方言补强）

#### Scenario: 检测到方言触发 TeleSpeechASR 补强

- **WHEN** SenseVoiceSmall 转写成功但语种标签命中方言集合（由环境变量 `DIALECT_LANGUAGE_TAGS` 配置，默认值：**`yue` 粤语**，仅粤语；`zh` 普通话和 `en` 英语不触发）
- **THEN** **前提条件**：`server/tools/telespeech.ts` 端点可用性探测结果为 true（首次调用前用最小音频样本探测 `POST /v1/audio/transcriptions model=TeleAI/TeleSpeechASR`，SiliconFlow 官方 API 文档**未列出**该模型，探测结果缓存到模块级变量）
- **AND** 探测通过则接口继续调用 TeleSpeechASR 二次转写
- **AND** 取两者中更优结果（优先 TeleSpeechASR 文本，若为空则回退 SenseVoiceSmall 文本）
- **AND** 返回 HTTP 200，body 含最终文本与 SenseVoiceSmall 识别的情感
- **AND** 探测失败（端点不可用）则自动降级为仅 SenseVoiceSmall 单独转写，不报错、不影响主流程
- **AND** `nan`（闽南语）/`wuu`（吴语）**不是 SenseVoice 官方枚举的语种标签**（官方仅 zh/en/yue/ja/ko/nospeech 6 种），扩展其他方言需先用真实方言样本实测 SenseVoiceSmall 输出标签后通过环境变量配置

#### Scenario: 音频文件参数校验失败返回 400

- **WHEN** 请求未携带音频文件，或文件大小超过限制（如 10MB），或 MIME 类型非 `audio/*`
- **THEN** 接口通过 `createError({ statusCode: 400, statusMessage: '参数校验失败: <错误消息>' })` 抛出错误
- **AND** HTTP 响应状态码为 400

#### Scenario: SenseVoiceSmall 调用失败返回 500

- **WHEN** SenseVoiceSmall 模型调用封装返回 `{ error, detail }`（网络异常、API 鉴权失败等）
- **THEN** 接口通过 `createError({ statusCode: 500, statusMessage: '语音转写失败，请重试' })` 抛出错误
- **AND** `console.error` 记录原始错误用于排查
- **AND** 响应 body 不包含原始错误堆栈或内部细节

#### Scenario: TeleSpeechASR 补强失败降级回 SenseVoiceSmall 结果

- **WHEN** 方言场景下 TeleSpeechASR 调用失败返回 `{ error, detail }`
- **THEN** 接口不抛出错误，降级使用 SenseVoiceSmall 的转写结果
- **AND** 返回 HTTP 200，body 含 SenseVoiceSmall 文本与情感
- **AND** `console.warn` 记录 TeleSpeechASR 降级信息

#### Scenario: 音频格式转换（WebM → WAV）

- **WHEN** 服务端收到前端上传的 WebM 音频文件
- **THEN** 忽略客户端原始文件名，重命名为 `tmp-<uuid>.webm`
- **AND** 使用 `child_process.spawn` 数组参数调用 ffmpeg 转码为 WAV（16kHz / 16bit / mono / PCM + 清除元数据）：`['ffmpeg', '-i', 'tmp-<uuid>.webm', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-map_metadata', '-1', 'wav-<uuid>.wav']`
- **AND** **关键**：输入/输出文件名均使用每请求独立 UUID（`tmp-<uuid>.webm` / `wav-<uuid>.wav`），**禁止固定文件名**（如 `output.wav`），防止并发请求串扰
- **AND** 转码后的 WAV 送入 ASR API 调用
- **AND** WAV 仅用于 API 调用，不落盘；调用结束后立即 `unlinkSync` 清理
- **AND** 原始 WebM 落盘存储供回放
- **AND** 若 ffmpeg 未安装（`spawnSync('ffmpeg', ['-version'])` 探测失败），返回 `{ error: 'ffmpeg_not_found', detail: '服务端未安装 ffmpeg，请联系管理员' }`

#### Scenario: 音频文件安全处理

- **WHEN** 服务端收到前端上传的 WebM 音频文件
- **THEN** 忽略客户端原始文件名，统一使用服务端生成的 `tmp-<uuid>.webm` 作为 ffmpeg 输入
- **AND** 落盘前经 ffmpeg 重新封装清除元数据：`ffmpeg -i tmp-<uuid>.webm -c copy -map_metadata -1 server/uploads/audio/<timestamp>-<uuid>.webm`
- **AND** `-map_metadata -1` 清除嵌入的元数据（EXIF、XMP 等），防止恶意文件注入
- **AND** 转码为 WAV 时同样使用 `-map_metadata -1` 参数
- **AND** 全程使用 `child_process.spawn` 数组参数，不通过 shell 拼接命令，防御命令注入
- **AND** 转码过程天然丢弃非音频数据，作为安全过滤层

#### Scenario: ffmpeg 输出文件并发隔离

- **WHEN** 多个 `/api/audio/transcribe` 请求并发到达服务端
- **THEN** 每个请求的 ffmpeg 输入/输出文件名使用独立的 UUID（`tmp-<uuid>.webm` / `wav-<uuid>.wav`）
- **AND** **禁止使用固定文件名**（如 `output.wav`），防止并发请求读写同一文件导致串扰或数据损坏
- **AND** 每个请求处理完成后清理其临时文件（`tmp-<uuid>.webm` / `wav-<uuid>.wav`）

### Requirement: SenseVoiceSmall 模型调用封装

`server/tools/sensevoice.ts` SHALL 封装 FunAudioLLM/SenseVoiceSmall 模型调用，输入音频文件（或 URL），输出 `{ text, emotion, language, events }`（文本、情感标签、语种标签、音频事件）。调用失败时 MUST 返回 `{ error: string, detail: string }` 对象，禁止 throw 异常（由 Workflow 调用方决定降级策略）。音频数据通过 URL 或文件路径传递，不进入 LLM 上下文。

#### Scenario: SenseVoiceSmall 调用成功

- **WHEN** 传入合法音频文件且模型 API 可达
- **THEN** 返回 `{ text: "<转写文本>", emotion: "<happy|sad|angry|neutral|...>", language: "<zh|yue|en|...>", events: [...] }`
- **AND** 不抛出异常

#### Scenario: SenseVoiceSmall 调用失败返回错误对象

- **WHEN** 模型 API 网络超时、鉴权失败或返回非 200 状态码
- **THEN** 返回 `{ error: "<错误类型>", detail: "<错误详情>" }` 对象
- **AND** 不 throw 异常（调用方通过判断返回值是否含 `error` 字段决定降级）

### Requirement: TeleSpeechASR 模型调用封装

`server/tools/telespeech.ts` SHALL 封装 TeleAI/TeleSpeechASR 模型调用，专攻方言场景转写（支持 60 种方言自由混说），输入音频文件，输出 `{ text }`（仅文本，不输出情感）。调用失败时 MUST 返回 `{ error, detail }` 对象，禁止 throw。该工具仅在 SenseVoiceSmall 检测到方言语种标签且端点可用性探测通过时由 Workflow 调用，不独立暴露给 LLM。

**端点可用性探测（实测发现）**：SiliconFlow 官方 API 文档（`/api-reference/audio/create-audio-transcriptions`）**未列出** `TeleAI/TeleSpeechASR` 模型。`server/tools/telespeech.ts` 在首次调用前 MUST 用最小音频样本探测 `POST /v1/audio/transcriptions model=TeleAI/TeleSpeechASR` 端点可用性：
1. 探测成功（HTTP 200）→ 缓存 `teleSpeechAvailable = true`，后续请求正常调用 TeleSpeechASR
2. 探测失败（404「model not found」或 400「invalid model」或其他网络错误）→ 缓存 `teleSpeechAvailable = false`，后续请求自动降级为「仅 SenseVoiceSmall 单独转写」
3. 探测结果缓存到模块级变量（`let teleSpeechAvailable: boolean | null = null`），避免每次请求重复探测
4. 即使探测通过，单次调用仍可能失败（限流、网络抖动等），此时按"调用失败"降级回 SenseVoiceSmall

#### Scenario: TeleSpeechASR 方言转写成功

- **WHEN** 传入方言音频文件，端点可用性探测结果为 true，且模型 API 可达
- **THEN** 返回 `{ text: "<方言转写文本>" }`
- **AND** 不抛出异常

#### Scenario: TeleSpeechASR 调用失败返回错误对象

- **WHEN** 模型 API 调用异常
- **THEN** 返回 `{ error: "<错误类型>", detail: "<错误详情>" }` 对象
- **AND** 不 throw 异常（Workflow 降级回 SenseVoiceSmall 结果）

#### Scenario: TeleSpeechASR 端点首次调用前可用性探测

- **WHEN** `server/tools/telespeech.ts` 模块首次被调用
- **THEN** 用最小音频样本 POST 到 `/v1/audio/transcriptions` 并指定 `model=TeleAI/TeleSpeechASR`
- **AND** **探测样本来源**：使用服务端生成的 1 秒静音 WAV 帧（`ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -c pcm_s16le probe.wav`），在 `server/tools/telespeech.ts` 模块加载时通过 `spawnSync` 调用 ffmpeg 生成并缓存到模块级变量 `probeAudioBuffer`，避免每次探测重复生成。若 ffmpeg 不可用，探测直接返回 `teleSpeechAvailable = false` 并降级
- **AND** 探测成功（HTTP 200）→ 缓存 `teleSpeechAvailable = true`，后续正常调用 TeleSpeechASR
- **AND** 探测失败（404/400/网络错误）→ 缓存 `teleSpeechAvailable = false`，后续自动降级为「仅 SenseVoiceSmall 单独转写」，不报错、不影响主流程

#### Scenario: TeleSpeechASR 端点探测失败时优雅降级

- **WHEN** 端点可用性探测结果为 `teleSpeechAvailable = false`（如 SiliconFlow 下线/迁移该模型）
- **THEN** Workflow 跳过 TeleSpeechASR 调用，直接使用 SenseVoiceSmall 转写结果
- **AND** 接口仍返回 HTTP 200，body 含 SenseVoiceSmall 文本与情感
- **AND** `console.warn` 记录「TeleSpeechASR 端点不可用，已降级为仅 SenseVoiceSmall」

### Requirement: 情感系统提示注入

`server/api/chat.post.ts` SHALL 接收请求 body 中的 `emotion` 字段（语音消息提交时携带），在最终 `finalSystemPrompt` 末尾追加情感提示语，仅注入本次 `streamText` 调用。情感信息不写入 `messages` 表（不作为独立持久化字段）。情感提示语 MUST 使用弱化语气（如「用户当前情绪可能为<开心>，请适当贴合该情绪回复」），避免强制语气导致回复生硬。非语音消息（无 `emotion` 字段）不注入情感提示。

**emotion 白名单校验（防 prompt 注入）**：`chat.post.ts` MUST 使用 `ALLOWED_EMOTIONS = new Set(['happy', 'sad', 'angry', 'neutral'])` 白名单校验 `body.audio.emotion`。仅接受四个白名单值之一，其他值（含 `null`、空串、`"unknown"`、`"EMO_UNKNOWN"`、任意攻击字符串）一律忽略不注入。校验实现：`emotion = typeof body.audio?.emotion === 'string' && ALLOWED_EMOTIONS.has(body.audio.emotion) ? body.audio.emotion : null`。

**注入位置硬约束**：emotion 提示语 MUST 追加到 `finalSystemPrompt` 拼接的**最末位**（即所有工具规则、用户位置上下文之后），确保情感提示不被任何工具规则冲淡。SenseVoice `EMO_UNKNOWN` 标签（情感未知）由 `sensevoice.ts` 解析时映射为 `emotion: null`，前端不展示情感标签，系统提示不注入情感。

#### Scenario: 语音消息提交时注入情感提示

- **WHEN** `/api/chat` 请求 body 携带 `audio: { emotion: "happy", url: "...", duration: ... }` 字段
- **THEN** `streamText` 的系统提示在最终 `finalSystemPrompt` 末尾追加「用户当前情绪可能为<happy>，请适当贴合该情绪回复」
- **AND** 该情感信息不写入 `messages` 表的任何字段

#### Scenario: 普通文本消息不注入情感提示

- **WHEN** `/api/chat` 请求 body 不携带 `audio.emotion` 字段
- **THEN** `streamText` 的系统提示保持现有 `finalSystemPrompt` 不变
- **AND** 不追加任何情感相关内容

#### Scenario: emotion 字段为空或未知值不注入

- **WHEN** 请求 body 的 `audio.emotion` 字段为空字符串、`null`、`"unknown"`、`"EMO_UNKNOWN"` 或其他非白名单值
- **THEN** 不追加情感提示
- **AND** 正常使用现有 `finalSystemPrompt`

#### Scenario: emotion 字段通过白名单校验后注入

- **WHEN** 请求 body 的 `audio.emotion` 字段为 `"happy"`/`"sad"`/`"angry"`/`"neutral"` 之一
- **THEN** 通过白名单校验，emotion 提示语正常注入 `finalSystemPrompt` 末尾
- **AND** 不会被任何工具规则或位置上下文冲淡

### Requirement: 音频文件本地存储与 TTL 自动清理

系统 SHALL 将转写后的音频文件存储到 `server/uploads/audio/<timestamp>-<uuid>.webm`（文件名编码创建时间戳），通过 API 路由 `/api/audio/:id` 代理访问（路由内校验用户 session 权限）。系统 MUST 设 TTL（默认 7 天）定时清理过期音频文件，防止磁盘膨胀。清理任务扫描 `server/uploads/audio/` 目录，解析文件名中的时间戳，删除超过 7 天的文件（使用文件名时间戳而非文件系统 `mtime`，避免备份/杀毒扫描等操作更新 `mtime` 导致文件永不过期）。转写文本永久保留（随 `messages` 表持久化），TTL 内用户可回放语音，TTL 过期后语音气泡降级为纯文字气泡。

#### Scenario: 音频文件存储到本地并返回可访问 URL

- **WHEN** `/api/audio/transcribe` 接收音频文件并完成转写
- **THEN** 音频文件保存为 `server/uploads/audio/<timestamp>-<uuid>.webm`（文件名编码创建时间戳）
- **AND** 返回的 `audioUrl` 为 `/api/audio/<uuid>`（通过 API 路由代理访问）
- **AND** 前端可通过该 URL 直接访问音频

#### Scenario: TTL 过期文件自动清理

- **WHEN** 定时清理任务执行，扫描 `server/uploads/audio/` 目录
- **AND** 某文件名中编码的时间戳距当前时间超过 7 天
- **THEN** 该文件被删除
- **AND** 不删除 `messages` 表中的转写文本记录（文本永久保留）

#### Scenario: 回放时音频文件已被清理降级为文字气泡

- **WHEN** 用户点击语音气泡的播放控件，但音频 URL 返回 404（文件已被 TTL 清理）
- **THEN** 语音气泡隐藏播放控件
- **AND** 自动展开「转文字」折叠面板展示转写文本
- **AND** 不显示错误 toast（降级为静默处理）

### Requirement: 语音消息气泡 UI

系统 SHALL 以气泡形式展示语音消息，气泡内含：音频播放控件（播放/暂停按钮 + 进度条 + 时长）、情感标签（开心/愤怒/疑惑等，作为元信息显示在气泡旁）、「转文字」折叠面板（默认折叠，点击展开显示转写文本）。语音气泡 MUST 遵循现有消息气泡宽度（用户消息 `max-w-[80%] sm:max-w-[75%]`）。情感标签用柔和配色区分不同情绪，禁止刺眼颜色。

> 注：AGENTS.md 全局规范要求用户消息 `max-w-[92%] sm:max-w-[85%]`，但当前 `ai-chat.vue` 实际使用 `max-w-[80%] sm:max-w-[75%]`。本次变更先遵循现有代码，避免局部不一致；如需统一至规范值，应作为独立全局样式变更处理。

#### Scenario: 语音消息展示气泡与情感标签

- **WHEN** 用户发送语音消息并完成转写
- **THEN** 消息列表展示用户语音气泡，含播放控件与时长
- **AND** 气泡旁显示情感标签（如「开心」），使用柔和配色

#### Scenario: 点击转文字展开折叠面板

- **WHEN** 用户点击语音气泡的「转文字」区域
- **THEN** 折叠面板平滑展开（`max-height` + `transition`，禁止 `v-if` 硬切）
- **AND** 展示转写文本内容
- **AND** 再次点击折叠收起

#### Scenario: 语音气泡宽度适配移动端

- **WHEN** 在手机端（< 640px）展示语音气泡
- **THEN** 气泡宽度不超过屏幕的 80%
- **AND** 播放控件与情感标签不溢出

#### Scenario: 语音气泡与虚拟滚动兼容（P1 约束）

- **WHEN** 消息列表使用虚拟滚动（`@tanstack/vue-virtual`）渲染语音气泡
- **THEN** 语音气泡 MUST 使用 `position: absolute` + `transform: translateY(start)` 定位（与虚拟列表其他项一致），**禁止使用 `<TransitionGroup>` 包裹虚拟滚动列表**（与 AGENTS.md「动画与过渡」章节约束一致）
- **AND** 语音气泡的高度变化（如「转文字」折叠面板展开/收起、情感标签渲染）**不得影响虚拟列表的定位计算**，折叠面板使用 `max-height` + `transition` 实现（不改变 DOM 结构）
- **AND** 音频播放控件在虚拟列表项复用（recycle）时 MUST 正确释放/重建 `<audio>` 实例，避免音频播放中断或串扰（虚拟列表滚动时项被回收，需确保 `onBeforeUnmount` 或 `measureElement` 回调中暂停播放并释放资源）
- **AND** 语音气泡的 DOM 结构 MUST 保持扁平（无嵌套绝对定位），避免与虚拟列表的 `measureElement` 高度测量冲突
