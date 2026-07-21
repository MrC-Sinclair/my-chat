## Requirements

### Requirement: 图片上传到 ImgBB

系统 SHALL 在 `server/api/chat.post.ts` 中，当请求 `body.images` 数组非空时，将每张 base64 data URL 图片先保存为本地文件，再上传到 ImgBB 获取公网 URL，用于后续传入 LLM。

- 系统 SHALL 在 `server/utils/imgbb.ts` 中实现 `uploadToImgBb(filePath: string): Promise<string>`，读取文件并转 base64 后 POST 到 `https://api.imgbb.com/1/upload`，返回 `json.data.url`
- 系统 SHALL 在 `chat.post.ts` 中实现 `saveBase64Image(base64: string): string`，将 data URL 解析为 buffer 后写入 `public/uploads/{timestamp}-{random}.{ext}`，返回 `/uploads/{filename}` 本地路径
- 上传流程 SHALL 为：`data:image/...` → `saveBase64Image` 保存本地文件 → `uploadToImgBb(fullPath)` 上传 ImgBB → 返回公网 URL
- ImgBB 上传成功后 SHALL 通过 `unlinkSync` 删除本地文件（[imgbb.ts#L39-L43](file:///d:/code/codeWork/my-chat/server/utils/imgbb.ts#L39-L43)）
- ImgBB 上传失败时 SHALL 降级返回原始 data URL（`return img`），并清理本地文件（[chat.post.ts#L348-L356](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L348-L356)）
- 系统 SHALL 在进入图片上传分支前校验 `process.env.IMGBB_API_KEY`，未配置时抛 `createError({ statusCode: 400, statusMessage: '图片对话功能不可用：未配置 IMGBB_API_KEY。请在 .env 中设置 IMGBB_API_KEY 后重试。' })`
- **关键约束**：硅基流动不支持 base64 图片，必须先上传到 ImgBB 获取公网 URL；在 `.env` 中配置 `IMGBB_API_KEY`，免费注册 <https://api.imgbb.com/> 获取

#### Scenario: 未配置 IMGBB_API_KEY 时拒绝图片对话

- **WHEN** 请求 `body.images` 数组非空
- **AND** `process.env.IMGBB_API_KEY` 未配置（空字符串）
- **THEN** 系统 SHALL 抛出 `createError({ statusCode: 400, statusMessage: '图片对话功能不可用：未配置 IMGBB_API_KEY。请在 .env 中设置 IMGBB_API_KEY 后重试。' })`
- **AND** SHALL 不进入图片上传流程

#### Scenario: base64 data URL 成功上传 ImgBB

- **WHEN** 请求 `body.images` 包含一项 `data:image/png;base64,...`
- **AND** `IMGBB_API_KEY` 已配置
- **THEN** 系统 SHALL 调用 `saveBase64Image` 将 base64 解码后写入 `public/uploads/` 本地文件
- **AND** SHALL 调用 `uploadToImgBb(fullPath)` 上传到 ImgBB
- **AND** SHALL 返回 ImgBB 公网 URL（如 `https://i.ibb.co/xxx.png`）加入 `imageUrls` 数组
- **AND** SHALL 删除本地临时文件

#### Scenario: ImgBB 上传失败时降级使用 data URL

- **WHEN** `uploadToImgBb` 抛出异常（API Key 失效 / 网络错误 / ImgBB 返回 `success: false`）
- **THEN** 系统 SHALL 在控制台打印 `ImgBB 上传失败，降级使用 base64:` 错误日志
- **AND** SHALL 清理本地临时文件（`unlinkSync(fullPath)`，忽略清理错误）
- **AND** SHALL 返回原始 data URL 字符串作为 `imageUrls` 项
- **AND** SHALL 不抛出异常，继续后续流程

### Requirement: 图片数量与大小限制

系统 SHALL 在 `chat.post.ts` 中对请求 `body.images` 数组强制执行数量与大小限制。

- 单条消息图片数量 SHALL 不超过 `MAX_IMAGES_PER_MESSAGE = 5` 张（[chat.post.ts#L56](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L56)）
- 单张图片 base64 字符串长度 SHALL 不超过 `MAX_IMAGE_SIZE * 1.37`，其中 `MAX_IMAGE_SIZE = 4 * 1024 * 1024`（4MB），`1.37` 为 base64 编码膨胀系数
- 超出数量限制时 SHALL 抛 `createError({ statusCode: 400, statusMessage: '图片数量超过限制（最多 5 张）' })`
- 超出大小限制时 SHALL 抛 `createError({ statusCode: 400, statusMessage: '图片大小超过限制（最多 4MB）' })`
- 校验仅针对 `typeof img === 'string'` 的项，对非字符串项跳过长度校验

#### Scenario: 图片数量超过 5 张

- **WHEN** 请求 `body.images` 数组长度为 6
- **THEN** 系统 SHALL 抛出 400 错误
- **AND** `statusMessage` SHALL 为 `'图片数量超过限制（最多 5 张）'`

#### Scenario: 单张图片 base64 长度超过 4MB * 1.37

- **WHEN** 请求 `body.images` 中某项字符串长度超过 `4 * 1024 * 1024 * 1.37`（约 5.56MB 字符）
- **THEN** 系统 SHALL 抛出 400 错误
- **AND** `statusMessage` SHALL 为 `'图片大小超过限制（最多 4MB）'`

#### Scenario: 图片数量与大小均在限制内

- **WHEN** 请求 `body.images` 数组长度 ≤ 5
- **AND** 每项字符串长度 ≤ `4 * 1024 * 1024 * 1.37`
- **THEN** 系统 SHALL 不抛出校验错误
- **AND** SHALL 进入 ImgBB 上传流程

### Requirement: 视觉模型多模态 parts 传入

系统 SHALL 在 `chat.post.ts` 中，当 `caps.vision === true` 且 `hasImages === true` 时，将图片作为多模态 content parts 传入 LLM，而非文本引用。

- 最后一条用户消息 SHALL 被构造为 `{ role: 'user', content: parts }`，其中 `parts` 是数组
- `parts` 第一项 SHALL 为 `{ type: 'text', text: textContent }`（原始用户文本）
- 公网 URL 图片 SHALL 作为 `{ type: 'image', image: new URL(url) }` 加入 `parts`（[chat.post.ts#L394](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L394)）
- ImgBB 失败降级的 data URL SHALL 通过 `parseBase64Meta(url)` 提取 base64 字符串和 mimeType，构造 `{ type: 'image', image: meta.base64, mimeType: meta.mimeType }` 加入 `parts`（[chat.post.ts#L385-L392](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L385-L392)）
- `parseBase64Meta` SHALL 通过正则 `^data:([\w/+-]+);base64,(.+)$` 解析 data URL，失败返回 `null`
- 视觉模型 SHALL NOT 在文本末尾注入 `[附图片N: URL]` 引用

#### Scenario: 视觉模型下公网 URL 作为多模态 parts 传入

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3.5-4B`（`caps.vision=true`）
- **AND** 用户上传了 1 张图片，ImgBB 上传成功返回 `https://i.ibb.co/xxx.png`
- **THEN** 最后一条用户消息 SHALL 被构造为 `{ role: 'user', content: [{ type: 'text', text: '原始文本' }, { type: 'image', image: new URL('https://i.ibb.co/xxx.png') }] }`
- **AND** SHALL NOT 在文本末尾追加 `[附图片1: ...]` 引用

#### Scenario: 视觉模型下 ImgBB 失败时复用 parseBase64Meta

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3.5-4B`（`caps.vision=true`）
- **AND** ImgBB 上传失败，`imageUrls` 中包含 `data:image/png;base64,xxx`
- **THEN** 系统 SHALL 调用 `parseBase64Meta('data:image/png;base64,xxx')` 提取 `{ mimeType: 'image/png', base64: 'xxx' }`
- **AND** SHALL 构造 `{ type: 'image', image: 'xxx', mimeType: 'image/png' }` 加入 `parts`
- **AND** LLM SHALL 能直接看到图片内容（视觉理解正常）

### Requirement: 非视觉模型文本引用注入

系统 SHALL 在 `chat.post.ts` 中，当 `caps.vision === false` 且 `hasImages === true` 时，将图片 URL 以文本引用形式注入最后一条用户消息末尾，禁止将图片作为多模态 parts 传入（避免 API 报错）。

- 注入位置 SHALL 为最后一条用户消息的文本内容末尾（`contextMessages.indexOf(msg) === lastUserIdx`）
- 公网 URL 注入格式 SHALL 为 `\n\n[附图片{N}: {URL}]`，N 从 1 开始递增（[chat.post.ts#L403-L405](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L403-L405)）
- 系统 SHALL 过滤掉 `data:` 开头的降级值（OCR 工具无法 fetch data URL），仅保留公网 URL 用于注入（[chat.post.ts#L400](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L400)）
- 当存在 `data:` 降级值时 SHALL 在文本末尾追加 `\n\n[提示：{N} 张图片上传失败，OCR 不可用，请重新上传]`，N 为 `data:` 项的数量（[chat.post.ts#L406-L408](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L406-L408)）
- 非视觉模型 SHALL NOT 将图片作为 `{ type: 'image' }` part 传入 LLM
- 视觉模型 SHALL 保持现有行为：图片作为多模态 content parts 传入

#### Scenario: 非视觉模型上传图片成功时注入文本引用

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`caps.vision=false`）
- **AND** 用户上传了 1 张图片，ImgBB 上传成功返回 `https://i.ibb.co/xxx.png`
- **THEN** 最后一条用户消息的文本末尾 SHALL 追加 `\n\n[附图片1: https://i.ibb.co/xxx.png]`
- **AND** 图片 SHALL NOT 作为 `{ type: 'image' }` part 传入 LLM
- **AND** LLM SHOULD 通过文本中的 URL 调用 `extractTextFromImage` 工具（由 prompt 引导，非代码保证）

#### Scenario: 非视觉模型 ImgBB 失败时注入降级提示

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`caps.vision=false`）
- **AND** 用户上传了 2 张图片，其中 1 张 ImgBB 上传成功（`https://i.ibb.co/xxx.png`），1 张失败（`data:image/png;base64,yyy`）
- **THEN** 系统 SHALL 过滤掉 `data:image/png;base64,yyy` 项
- **AND** 文本末尾 SHALL 追加 `\n\n[附图片1: https://i.ibb.co/xxx.png]`
- **AND** 文本末尾 SHALL 追加 `\n\n[提示：1 张图片上传失败，OCR 不可用，请重新上传]`
- **AND** SHALL NOT 注入 `[附图片2: data:image/png;base64,yyy]`（OCR 工具无法 fetch data URL）

#### Scenario: 视觉模型图片处理保持不变

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3.5-4B`（`caps.vision=true`）
- **AND** 用户上传了图片
- **THEN** 图片 SHALL 作为 `{ type: 'image' }` 多模态 parts 传入 LLM
- **AND** SHALL NOT 注入文本引用（视觉模型可直接看到图片）

### Requirement: 图片上传按钮显示条件

系统 SHALL 在 `components/chat/ChatInput.vue` 中通过 `canUploadImage` computed 控制图片上传按钮的可见性与可交互性。

- `canUploadImage` SHALL 等于 `props.supportsVision || props.enableOcr`（[ChatInput.vue#L76](file:///d:/code/codeWork/my-chat/components/chat/ChatInput.vue#L76)）
- 视觉模型（`supportsVision=true`）SHALL 始终显示上传按钮，无论 OCR 是否开启
- 非视觉模型（`supportsVision=false`）SHALL 仅在 `enableOcr=true` 时显示上传按钮
- 非视觉模型且 OCR 关闭时 SHALL 隐藏上传按钮（按钮文字色为 `text-semi-border`，`cursor-not-allowed`，`<input>` 的 `disabled` 为 true）
- 上传按钮 SHALL 提供 `v-tooltip` 提示，文案根据 `canUploadImage` 切换：「添加图片」/「当前模型不支持图片，请先开启 OCR 工具」
- `useChatConfig.ts` SHALL 通过 `supportsVision = computed(() => currentCapabilities.value.vision)` 暴露视觉能力判断
- `useChatConfig.ts` SHALL 通过 `currentSupportsOcr = computed(() => currentCapabilities.value.toolCalling)` 暴露 OCR 工具可用性判断
- 切换到 `toolCalling=false` 模型时 SHALL 自动将 `enableOcr` 重置为 `false`（避免 toggle 开启但工具不可用的不一致状态，[useChatConfig.ts#L69-L77](file:///d:/code/codeWork/my-chat/composables/useChatConfig.ts#L69-L77)）

#### Scenario: 视觉模型始终可上传图片

- **WHEN** 用户选中 `Qwen/Qwen3.5-4B`（`vision=true`）
- **THEN** `canUploadImage` SHALL 为 `true`
- **AND** 图片上传按钮 SHALL 可见且可点击
- **AND** tooltip SHALL 显示「添加图片」
- **AND** 无论 `enableOcr` 是否开启，按钮均可见

#### Scenario: 非视觉模型 OCR 开启时可上传图片

- **WHEN** 用户选中 `Qwen/Qwen3-8B`（`vision=false, toolCalling=true`）
- **AND** `enableOcr=true`
- **THEN** `canUploadImage` SHALL 为 `true`
- **AND** 图片上传按钮 SHALL 可见且可点击
- **AND** tooltip SHALL 显示「添加图片」

#### Scenario: 非视觉模型 OCR 关闭时隐藏上传按钮

- **WHEN** 用户选中 `Qwen/Qwen3-8B`（`vision=false, toolCalling=true`）
- **AND** `enableOcr=false`
- **THEN** `canUploadImage` SHALL 为 `false`
- **AND** 图片上传按钮 SHALL 显示为禁用样式（`text-semi-border`、`cursor-not-allowed`）
- **AND** tooltip SHALL 显示「当前模型不支持图片，请先开启 OCR 工具」
- **AND** `<input type="file">` SHALL 被 `disabled`

#### Scenario: 切换到不支持工具调用的模型时自动关闭 OCR

- **WHEN** 用户从 `Qwen/Qwen3-8B` 切换到 `THUDM/GLM-Z1-9B-0414`（`toolCalling=false`）
- **THEN** `enableOcr` SHALL 自动重置为 `false`
- **AND** `canUploadImage` SHALL 为 `false`
- **AND** 图片上传按钮 SHALL 被禁用

### Requirement: 消息持久化图片 URL

系统 SHALL 在 `chat.post.ts` 的 `saveMessagesToDb` 函数中，将图片 URL 存入最后一条用户消息的 `metadata.images` 数组。

- `saveMessagesToDb` SHALL 仅保存最后一条用户消息（通过 `[...chatMessages].reverse().find((msg) => msg.role === 'user')` 反向查找），避免重复插入历史消息（[chat.post.ts#L864](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L864)）
- 当 `imageUrls && imageUrls.length > 0` 时 SHALL 构造 `meta.images = imageUrls.map((url, i) => ({ index: i, url }))`
- `metadata` 字段 SHALL 在 `meta` 为空对象时传入 `undefined`，非空时传入 `meta` 对象
- 用户消息文本 SHALL 通过 `extractTextFromMessage` 兼容 AI SDK v5 parts 格式与旧 content 字符串格式
- 持久化 SHALL 在 `streamText` 的 `onFinish` 回调中执行，禁止在 `onChunk` 中写库
- 持久化失败时 SHALL 仅打印 `保存消息到数据库失败:` 错误日志，不抛出异常（不阻塞流结束）

#### Scenario: 上传图片后用户消息持久化包含 metadata.images

- **WHEN** 用户上传了 2 张图片，ImgBB 上传成功返回 `https://i.ibb.co/a.png` 和 `https://i.ibb.co/b.png`
- **AND** `streamText` 的 `onFinish` 回调触发
- **THEN** `saveMessagesToDb` SHALL 仅插入最后一条用户消息
- **AND** 用户消息的 `metadata.images` SHALL 为 `[{ index: 0, url: 'https://i.ibb.co/a.png' }, { index: 1, url: 'https://i.ibb.co/b.png' }]`
- **AND** 用户消息的 `content` SHALL 为 `extractTextFromMessage(lastUserMessage)` 提取的纯文本（不含图片 URL 注入）

#### Scenario: 未上传图片时用户消息 metadata 为 undefined

- **WHEN** 用户未上传图片（`imageUrls` 为空数组或 `undefined`）
- **THEN** `saveMessagesToDb` SHALL 将 `metadata` 字段设为 `undefined`
- **AND** 数据库中该条用户消息的 `metadata` 列 SHALL 为 `NULL`

#### Scenario: 持久化失败不阻塞流

- **WHEN** `db.insert` 抛出异常（数据库连接失败等）
- **THEN** 系统 SHALL 在控制台打印 `保存消息到数据库失败:` 错误日志
- **AND** SHALL NOT 重新抛出异常
- **AND** SHALL NOT 阻塞 `onFinish` 回调后续逻辑（如服务端归档兜底）

### Requirement: 图片对话统一使用 streamText()

系统 SHALL 在 `chat.post.ts` 中，对纯文本对话和图片对话统一使用 `streamText()` 处理，不区分调用路径。

- 纯文本消息 SHALL 通过 `streamText()` 处理，`messages` 参数为 `llmMessages`
- 图片消息 SHALL 通过 `streamText()` 处理，图片先上传 ImgBB 获取公网 URL 后作为多模态 content parts 传入 `llmMessages`
- 系统 SHALL NOT 为图片对话单独创建 API 路由或调用路径
- `streamText()` 的 `onFinish` 回调 SHALL 负责消息持久化（含图片 URL metadata）
- 图片对话 SHALL NOT 在 `onChunk` 中写库

#### Scenario: 纯文本对话走 streamText

- **WHEN** 请求 `body.images` 为空或未提供
- **THEN** 系统 SHALL 调用 `streamText({ model, system, messages: llmMessages, ... })`
- **AND** `llmMessages` SHALL 全部为 `{ role: 'user' | 'assistant', content: string }` 纯文本格式
- **AND** SHALL NOT 进入图片上传分支

#### Scenario: 图片对话走 streamText（视觉模型）

- **WHEN** 请求 `body.images` 非空
- **AND** `model` 为视觉模型（`caps.vision=true`）
- **THEN** 系统 SHALL 先将图片上传 ImgBB 获取公网 URL
- **AND** SHALL 构造 `llmMessages` 中最后一条用户消息为 `{ role: 'user', content: parts }` 多模态格式
- **AND** SHALL 调用 `streamText()` 传入多模态 `llmMessages`

#### Scenario: 图片对话走 streamText（非视觉模型）

- **WHEN** 请求 `body.images` 非空
- **AND** `model` 为非视觉模型（`caps.vision=false`）
- **THEN** 系统 SHALL 先将图片上传 ImgBB 获取公网 URL
- **AND** SHALL 在最后一条用户消息文本末尾注入 `[附图片N: URL]` 引用
- **AND** SHALL 调用 `streamText()` 传入文本形式的 `llmMessages`

### Requirement: 硅基流动不支持 base64 图片

系统 SHALL 通过 ImgBB 上传机制规避硅基流动 API 不支持 base64 图片的限制。

- 硅基流动 SHALL NOT 接收 base64 data URL 作为 `{ type: 'image', image: ... }` 的 image 字段
- 系统 SHALL 在视觉模型路径中将公网 URL 包装为 `new URL(url)` 传入 `streamText`（[chat.post.ts#L394](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L394)）
- 系统 SHALL 在非视觉模型路径中将公网 URL 以文本引用 `[附图片N: URL]` 注入，由 LLM 调用 OCR 工具 fetch URL
- **唯一例外**：ImgBB 上传失败时，视觉模型路径 SHALL 通过 `parseBase64Meta` 提取 base64 字符串（不是 data URL）传入 LLM，作为降级方案
- **关键约束**：在 `.env` 中配置 `IMGBB_API_KEY`，免费注册 <https://api.imgbb.com/> 获取

#### Scenario: 视觉模型正常路径下传入公网 URL

- **WHEN** 请求的 `model` 为视觉模型
- **AND** ImgBB 上传成功
- **THEN** 系统 SHALL 构造 `{ type: 'image', image: new URL('https://i.ibb.co/xxx.png') }`
- **AND** SHALL NOT 传入 `data:image/...;base64,...` 字符串

#### Scenario: 非视觉模型通过文本引用让 LLM fetch URL

- **WHEN** 请求的 `model` 为非视觉模型
- **AND** ImgBB 上传成功
- **THEN** 系统 SHALL 注入 `[附图片N: https://i.ibb.co/xxx.png]` 文本引用
- **AND** LLM SHALL 通过 `extractTextFromImage` 工具 fetch 公网 URL（由 prompt 引导）

#### Scenario: ImgBB 失败时视觉模型降级使用 base64 字符串

- **WHEN** 请求的 `model` 为视觉模型
- **AND** ImgBB 上传失败
- **THEN** 系统 SHALL 通过 `parseBase64Meta` 提取 base64 字符串（不含 `data:` 前缀）
- **AND** SHALL 构造 `{ type: 'image', image: '<base64-string>', mimeType: 'image/png' }`
- **AND** SHALL NOT 传入完整 `data:image/png;base64,...` 字符串

### Requirement: 视觉/非视觉模型能力分流

系统 SHALL 在 `chat.post.ts` 中通过 `getModelCapabilities(useModel).vision` 判断模型视觉能力，并据此分流图片处理路径。新增模型必须在 `server/config/models.ts` 中正确配置 `capabilities`。

- `useModel` SHALL 通过 `ALLOWED_MODEL_VALUES.has(model) ? model : DEFAULT_LLM_MODEL` 校验，非法模型回退到默认值（[chat.post.ts#L329](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L329)）
- `caps` SHALL 通过 `getModelCapabilities(useModel)` 获取
- `caps.vision === true` 时 SHALL 走多模态 parts 路径
- `caps.vision === false` 时 SHALL 走文本引用注入路径
- **关键约束**：视觉/推理模型不支持 `enable_thinking` 参数，通过 `caps.toggleableThinking` 判断是否传 `enableThinking`（[chat.post.ts#L422-L424](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L422-L424)）
- **关键约束**：新增模型必须在 `server/config/models.ts` 中正确配置 `capabilities`（`vision`、`deepThinking`、`toggleableThinking`、`toolCalling`），并在 `useChatConfig.ts` 的 `FALLBACK_MODELS` 中同步补充，确保 SSR 时 capabilities 判断准确

#### Scenario: 视觉模型走多模态 parts 路径

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3.5-4B`（`caps.vision=true`）
- **AND** 用户上传了图片
- **THEN** 系统 SHALL 走多模态 parts 路径
- **AND** 图片 SHALL 作为 `{ type: 'image' }` part 传入 LLM

#### Scenario: 非视觉模型走文本引用注入路径

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`caps.vision=false`）
- **AND** 用户上传了图片
- **THEN** 系统 SHALL 走文本引用注入路径
- **AND** 图片 SHALL NOT 作为 `{ type: 'image' }` part 传入 LLM
- **AND** SHALL 在文本末尾注入 `[附图片N: URL]` 引用

#### Scenario: 非法模型回退到默认模型

- **WHEN** 请求的 `model` 不在 `ALLOWED_MODEL_VALUES` 集合中
- **THEN** 系统 SHALL 使用 `DEFAULT_LLM_MODEL`（`process.env.LLM_MODEL || 'Qwen/Qwen3-8B'`）
- **AND** SHALL 通过 `getModelCapabilities` 获取默认模型的 capabilities
