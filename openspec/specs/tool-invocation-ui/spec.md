## Requirements

### Requirement: 显式工具分支硬约束

`ToolInvocation.vue` SHALL 对项目支持的每种工具类型显式定义独立的 `v-if="invocation.toolName === '<toolName>'"` 渲染分支，禁止依赖通用兜底分支承载已知工具的渲染。

- 当前 SHALL 包含以下显式分支（按 template 顺序）：`weather` / `getCityByIp` / `webSearch` / `extractTextFromImage` / `recallMemory` / `generateImage`
- **项目硬约束**：每新增一种工具类型（在 `server/tools/` 用 `tool()` 定义并在 `chat.post.ts` 注册），SHALL 同步在 `ToolInvocation.vue` 中新增对应的显式 `v-if` 分支，包括 OCR、generateImage 等所有未来工具
- 兜底分支（`v-else`）SHALL 仅用于未知工具类型（显示"工具调用: {toolName}"），不应被任何已知工具命中
- 已知工具若未新增显式分支 SHALL 导致 UI 渲染兜底分支（"工具调用: xxx"），视为实现遗漏

#### Scenario: 新增工具类型时必须新增显式分支

- **WHEN** 开发者在 `server/tools/` 新增一种工具（如 `translateText`）并在 `chat.post.ts` 注册
- **THEN** `ToolInvocation.vue` SHALL 同步新增 `v-else-if="invocation.toolName === 'translateText'"` 分支
- **AND** SHALL 包含加载中、成功、错误三种状态的渲染
- **AND** 兜底分支 SHALL 不被该工具命中

#### Scenario: 已知工具命中显式分支

- **WHEN** LLM 调用 `weather` 工具
- **THEN** 组件 SHALL 命中 `v-if="invocation.toolName === 'weather'"` 分支
- **AND** SHALL NOT 命中兜底 `v-else` 分支

### Requirement: 加载中状态视觉规范

`ToolInvocation.vue` SHALL 对所有工具分支统一加载中状态的视觉表现：脉冲点动画 + 紫色光晕背景 + 提示文字。

- 加载状态判定条件 SHALL 为 `isCalling(invocation.state)`，即 `state === 'input-streaming' || state === 'input-available'`
- 加载容器 SHALL 使用 `bg-semi-primary-light/60` + `border-semi-primary/30` + `rounded-xl` + `text-semi-primary-active` 紫色光晕样式
- 加载指示器 SHALL 为 `relative flex h-4 w-4` 的双层圆形 + `animate-ping` 脉冲动画
- 提示文字 SHALL 为 `text-xs sm:text-sm`，内容因工具而异（如"正在查询 X 的天气..."、"正在通过 IP X 定位城市..."、"正在搜索: X..."、"正在识别图片中的文字..."、"正在回忆历史记忆..."、"正在生成图片：X..."）
- 各工具分支的加载样式 SHALL 保持一致（仅文字内容不同），避免视觉割裂

#### Scenario: 工具调用中显示加载动画

- **WHEN** 任一工具的 `invocation.state` 为 `input-streaming` 或 `input-available`
- **THEN** 组件 SHALL 渲染紫色光晕背景的加载容器
- **AND** SHALL 显示双层圆形脉冲动画
- **AND** SHALL 显示该工具对应的加载提示文字

### Requirement: 成功状态判定与结果展示

`ToolInvocation.vue` SHALL 在工具调用成功完成时展示结果区域。

- 成功状态判定条件 SHALL 为 `invocation.state === 'output-available' && invocation.output`
- 结果容器 SHALL 使用 `bg-semi-bg-0 border border-semi-border rounded-xl overflow-hidden shadow-semi-card` 统一卡片样式
- 头部 SHALL 使用 `bg-gradient-to-r from-semi-primary-light to-semi-primary-light` 渐变背景 + 底部分隔线（`border-b border-semi-divider`）
- 结果区域 SHALL 进一步根据 `output.error` / `output.city` / `output.results` 等字段分支渲染具体内容
- 各工具的成功结果展示 SHALL 包含工具特定的头部图标 + 标题 + 数据区域

#### Scenario: 工具调用成功展示结果卡片

- **WHEN** 工具 `invocation.state` 为 `output-available`
- **AND** `invocation.output` 存在且不含 `error` 字段
- **THEN** 组件 SHALL 渲染带圆角边框 + 阴影的卡片容器
- **AND** SHALL 渲染紫色渐变头部（含图标 + 标题）
- **AND** SHALL 渲染工具特定的结果数据区域

### Requirement: 错误状态视觉规范

`ToolInvocation.vue` SHALL 对所有工具分支统一错误状态的视觉表现：红色背景 + 错误图标 + 错误详情。

- 错误状态判定条件 SHALL 满足以下任一：
  - `invocation.state === 'output-error'`
  - `invocation.output.error` 字段存在（部分工具返回结构化错误对象，state 仍为 `output-available`）
- 错误容器 SHALL 使用 `bg-semi-danger-light` 红色背景
- 错误图标 SHALL 为带感叹号的圆形 SVG（`circle cx=12 cy=12 r=10` + 中间感叹线），颜色 `text-semi-danger`
- 错误标题 SHALL 使用 `text-semi-danger font-medium` + `text-xs sm:text-sm`
- 错误详情（`output.detail` 字段）SHALL 使用 `text-semi-micro text-semi-text-3` + 缩进样式
- generateImage 工具的错误状态 SHALL 额外显示"等待 AI 自主决定是否重试..."提示（因 Agent 架构下 LLM 自主决策重试）

#### Scenario: 工具返回结构化错误对象

- **WHEN** 工具 `invocation.state` 为 `output-available`
- **AND** `invocation.output.error` 字段存在
- **THEN** 组件 SHALL 渲染红色背景的错误容器
- **AND** SHALL 显示错误图标 + 错误标题（取自 `output.error`）
- **AND** 若 `output.detail` 存在 SHALL 显示错误详情

#### Scenario: 工具调用状态为 output-error

- **WHEN** 工具 `invocation.state` 为 `output-error`
- **THEN** 组件 SHALL 渲染红色背景的错误容器
- **AND** SHALL 显示 `invocation.errorText` 或"未知错误"

### Requirement: weather 工具分支

`ToolInvocation.vue` SHALL 在 `invocation.toolName === 'weather'` 时渲染天气查询结果，包含城市信息、当前天气和未来预报。

- 加载状态文字 SHALL 为"正在查询 {input.city} 的天气..."
- 头部 SHALL 显示天气图标 + `output.city` + `output.region`
- 当前天气区域 SHALL 显示：
  - 大字号温度（`text-3xl sm:text-4xl font-light tracking-tight`）
  - 体感温度（`current.feelsLike`）
  - 湿度（`current.humidity`）
  - 风向 + 风速（`current.windDirection` + `current.windSpeed`）
  - 天气状况（`current.condition`）
- 未来预报区域 SHALL 横向滚动展示 `output.forecast` 数组（每项含 `day`、`condition`、`low`~`high`、`rainChance`）
- 预报项 SHALL 使用 `min-w-[72px] sm:min-w-[80px]` 固定最小宽度，`flex-shrink-0`
- 预报容器 SHALL 使用 `overflow-x-auto` 支持横向滚动
- 当 `output.error` 存在时 SHALL 显示红色背景的错误信息（非卡片样式）

#### Scenario: 查询天气成功展示完整结果

- **WHEN** `invocation.toolName === 'weather'`
- **AND** `invocation.state === 'output-available'`
- **AND** `invocation.output` 不含 `error`
- **THEN** 组件 SHALL 渲染带城市/地区标题的渐变头部
- **AND** SHALL 渲染当前温度大字号 + 体感/湿度/风速/状况 4 项指标
- **AND** SHALL 渲染未来预报横向滚动列表（每项含 day/condition/温度范围）

#### Scenario: 查询天气失败展示错误

- **WHEN** `invocation.toolName === 'weather'`
- **AND** `invocation.output.error` 存在
- **THEN** 组件 SHALL 渲染红色背景的错误信息（`output.error`）
- **AND** SHALL NOT 渲染卡片头部与数据区域

### Requirement: getCityByIp 工具分支

`ToolInvocation.vue` SHALL 在 `invocation.toolName === 'getCityByIp'` 时渲染 IP 定位结果，包含城市、地区、国家信息，并区分本地 IP 与错误状态。

- 加载状态文字 SHALL 为"正在通过 IP {input.ip} 定位城市..."
- 头部 SHALL 显示定位图标 + "IP 定位结果" 标题
- 成功状态（`output.city` 存在）SHALL 显示：
  - 城市（`font-medium text-semi-text-0`）
  - 地区（`output.region`，可选）
  - 国家（`output.country`，前缀 "· "）
- 本地/内网 IP（`output.isLocal === true`）SHALL 显示信息图标 + "本地网络环境，无法通过 IP 定位城市" 提示
- 错误状态 SHALL 显示 `output.error` 或兜底文案"IP 定位失败"
- `IpLocationResult` 类型 SHALL 包含 `lat`/`lon` 坐标字段（供 weather 工具链式调用使用，UI 不直接展示坐标）

#### Scenario: IP 定位到具体城市

- **WHEN** `invocation.toolName === 'getCityByIp'`
- **AND** `invocation.output.city` 存在
- **THEN** 组件 SHALL 渲染带定位图标的头部
- **AND** SHALL 显示城市名 + 地区 + 国家信息

#### Scenario: 本地 IP 无法定位

- **WHEN** `invocation.toolName === 'getCityByIp'`
- **AND** `invocation.output.isLocal === true`
- **THEN** 组件 SHALL 显示信息图标 + "本地网络环境，无法通过 IP 定位城市" 提示

#### Scenario: IP 定位失败

- **WHEN** `invocation.toolName === 'getCityByIp'`
- **AND** `invocation.output.error` 存在
- **THEN** 组件 SHALL 显示 `output.error` 或"IP 定位失败"

### Requirement: webSearch 工具分支

`ToolInvocation.vue` SHALL 在 `invocation.toolName === 'webSearch'` 时渲染搜索结果列表，每项包含标题、链接、摘要 snippet。

- 加载状态文字 SHALL 为"正在搜索: {input.query}..."
- 头部 SHALL 显示搜索图标 + "搜索结果" 标题 + `output.query`
- 结果列表 SHALL 最多展示前 4 条结果（`results.slice(0, 4)`）
- 每条结果 SHALL 包含：
  - 网站 favicon（通过 `https://www.google.com/s2/favicons?domain={hostname}&sz=32` 获取，加载失败通过 `@error` 隐藏 `<img>`）
  - 标题链接（`<a target="_blank" rel="noopener noreferrer">`，`line-clamp-1`，紫色高亮 `text-semi-primary`）
  - 来源域名（`getDomain(url)`，去除 `www.` 前缀）
  - 摘要 snippet（`line-clamp-2 leading-relaxed`，`text-xs text-semi-text-3`）
- 每条结果 SHALL 使用 `hover:bg-semi-bg-1 transition-colors duration-semi-fast` 悬浮反馈
- 当 `output.error` 存在时 SHALL 显示红色背景的错误信息

#### Scenario: 搜索成功展示结果列表

- **WHEN** `invocation.toolName === 'webSearch'`
- **AND** `invocation.state === 'output-available'`
- **AND** `invocation.output.results` 数组存在
- **THEN** 组件 SHALL 渲染带搜索图标的头部 + query 摘要
- **AND** SHALL 渲染最多 4 条结果
- **AND** 每条结果 SHALL 包含 favicon + 标题链接 + 来源域名 + 摘要

#### Scenario: 搜索结果 favicon 加载失败

- **WHEN** favicon 图片加载失败
- **THEN** SHALL 通过 `@error` 处理器隐藏 `<img>` 元素（`($event.target as HTMLImageElement).style.display = 'none'`）
- **AND** SHALL 不影响其他结果项的渲染

### Requirement: extractTextFromImage 工具分支

`ToolInvocation.vue` SHALL 在 `invocation.toolName === 'extractTextFromImage'` 时渲染 OCR 识别结果，包含识别完成标签、Markdown 文字预览和图片缩略图（带 URL 安全校验）。

- 加载状态文字 SHALL 为"正在识别图片中的文字..."
- 头部 SHALL 显示文档图标 + "OCR 识别完成" 标题 + 复制按钮（`ml-auto`）
- 复制按钮 SHALL 调用 `copyOcrText()` 复制 `output.text` 或 `output.error`，复制后切换"已复制"文案 1.5s 后恢复
- 内容区域 SHALL 包含图片缩略图 + 文字预览（横向布局 `flex gap-3`）：
  - 缩略图尺寸 SHALL 为 `w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-md`
  - 文字预览 SHALL 显示 `output.text.slice(0, 200)` + 超过 200 字符显示"..."
  - `output.text` 为空时 SHALL 显示"未识别到文字"斜体提示
- **图片 URL 安全校验（关键约束）**：渲染 `<img :src="input.imageUrl">` 前 SHALL 调用 `getInputImageUrl()` 校验：
  - URL 协议 SHALL 为 `https:`（`OCR_ALLOWED_PROTOCOLS = ['https:']`）
  - URL 域名 SHALL 在 `OCR_ALLOWED_DOMAINS` 白名单内（`i.ibb.co` / `i.imgur.com` / `cdn.discordapp.com` / `pbs.twimg.com` / `*.alicdn.com` / `*.qpic.cn` / `*.weixin.qq.com`）
  - 通配符域名（如 `*.alicdn.com`）SHALL 通过 `matchOcrDomain()` 匹配，hostname 以 `.alicdn.com` 后缀结尾且长度大于后缀本身
  - 校验失败时 SHALL 渲染占位图标（图片图标）而非 `<img>`
  - 此客户端校验仅用于决定 `<img>` 是否渲染，实际 SSRF 强制校验（含 DNS 内网 IP 检查）在服务端 `validateImageUrl` 执行
- 错误状态 SHALL 显示红色背景（`bg-semi-danger-light`）+ 错误图标 + `output.error` + `output.detail`

#### Scenario: OCR 成功展示识别结果

- **WHEN** `invocation.toolName === 'extractTextFromImage'`
- **AND** `invocation.state === 'output-available'`
- **AND** `invocation.output` 不含 `error`
- **THEN** 组件 SHALL 渲染"OCR 识别完成"头部 + 复制按钮
- **AND** SHALL 渲染图片缩略图（若 URL 通过白名单校验）或占位图标
- **AND** SHALL 渲染 `output.text` 前 200 字符预览

#### Scenario: 图片 URL 协议非 https

- **WHEN** `input.imageUrl` 协议为 `http:` 或 `data:`
- **THEN** `getInputImageUrl()` SHALL 返回 `null`
- **AND** 组件 SHALL 渲染占位图标而非 `<img>`

#### Scenario: 图片 URL 域名不在白名单

- **WHEN** `input.imageUrl` 域名不在 `OCR_ALLOWED_DOMAINS` 白名单内
- **THEN** `getInputImageUrl()` SHALL 返回 `null`
- **AND** 组件 SHALL 渲染占位图标而非 `<img>`

#### Scenario: 用户点击复制按钮

- **WHEN** 用户点击 OCR 头部的"复制"按钮
- **THEN** SHALL 调用 `navigator.clipboard.writeText()` 复制 `output.text` 或 `output.error`
- **AND** 按钮文案 SHALL 切换为"已复制" 1.5s 后恢复为"复制"

### Requirement: recallMemory 工具分支

`ToolInvocation.vue` SHALL 在 `invocation.toolName === 'recallMemory'` 时渲染跨会话长期记忆检索结果，包含错误、空结果、有结果三种状态。

- 加载状态文字 SHALL 为"正在回忆历史记忆..."
- 错误状态（`output.error` 存在）SHALL 显示红色背景 + 错误图标 + `output.error` + `output.detail`
- 空结果状态（`output.memories` 为空数组或不存在）SHALL 显示搜索图标 + `output.message` 或兜底文案"未找到相关历史记忆"
- 有结果状态 SHALL 显示：
  - 头部：大脑图标 + "已检索 {N} 条相关记忆" 标题（N 为 `memories.length`）+ 降级模式警告标签（`output.warning` 存在时显示"降级模式"）
  - 记忆列表：最多展示前 3 条（`memories.slice(0, 3)`），超出部分在第三条（`idx === 2`）显示"+{N} 条"
  - 每条记忆 SHALL 包含：
    - 角色标签（`memory.role === 'user'` → 显示"我" + `bg-semi-primary-light text-semi-primary-active`；其他 → 显示"AI" + `bg-semi-bg-2 text-semi-text-3`）
    - 相关度百分比（`Math.round(memory.score * 100) %`）
    - 内容（`line-clamp-2 leading-relaxed`，`text-xs text-semi-text-2`）

#### Scenario: 检索到记忆并展示列表

- **WHEN** `invocation.toolName === 'recallMemory'`
- **AND** `invocation.output.memories` 数组长度 > 0
- **THEN** 组件 SHALL 渲染"已检索 {N} 条相关记忆"头部
- **AND** SHALL 渲染最多 3 条记忆项
- **AND** 每条记忆 SHALL 显示角色标签 + 相关度 + 内容

#### Scenario: 检索无结果

- **WHEN** `invocation.output.memories` 为空数组或不存在
- **THEN** 组件 SHALL 显示 `output.message` 或"未找到相关历史记忆"

#### Scenario: reranker 降级模式

- **WHEN** `invocation.output.warning` 字段存在
- **THEN** 头部 SHALL 显示"降级模式"标签（`text-semi-micro text-semi-text-3`，`ml-auto`）

### Requirement: generateImage 工具分支

`ToolInvocation.vue` SHALL 在 `invocation.toolName === 'generateImage'` 时渲染 AI 文生图结果，包含图片展示、下载按钮、复制链接按钮和图片放大模态。

- 加载状态文字 SHALL 为"正在生成图片：{input.prompt} ..."（prompt 存在时显示，否则为"正在生成图片 ..."）
- 成功状态判定 SHALL 使用 `!isGenerateImageFailure(output)`，即 `output.detail` 字段不为 string
- 成功状态 SHALL 显示：
  - 头部：图片图标 + "AI 生成图片" 标题 + 耗时（`inferenceTime / 1000` 秒，保留 1 位小数）+ seed
  - 图片缩略图：`max-w-[200px] w-full h-auto object-contain`，点击触发 `showImageModal = true`，`cursor-zoom-in` + `active:scale-[0.98]`
  - 操作按钮组（`flex sm:flex-col gap-1.5 sm:gap-1 flex-wrap`）：
    - 放大查看按钮：调用 `showImageModal = true`，`v-tooltip="'放大查看'"`
    - 下载按钮：调用 `downloadImage(url, seed)`，文件名 `kolors-{seed}.png`，`v-tooltip="'下载图片'"`
    - 复制链接按钮：调用 `copyImageLink(url)`，复制后切换"已复制"文案 1.5s 后恢复，图标切换为对勾（`text-semi-success`）
  - ImgBB 转存失败警告（`output.warning` 存在时）：显示橙色警告背景 + 警告图标 + warning 文案
- 失败状态（`isGenerateImageFailure(output)` 为 true）SHALL 显示：
  - 红色背景（`bg-semi-danger-light`）+ 错误图标 + `output.error` + `output.detail`
  - "等待 AI 自主决定是否重试..."提示（Agent 架构下 LLM 自主决策重试）
- `output-error` 状态（output 不存在但 state 为 error）SHALL 显示"图片生成失败" + `invocation.errorText` 或"未知错误" + 重试提示
- `downloadImage()` SHALL 优先通过 `fetch` + `blob` + `<a download>` 触发下载，失败时降级用 `<a download href target="_blank" rel="noopener noreferrer">` 直接打开
- 图片放大模态 SHALL：
  - 用 `<ClientOnly>` 包裹（避免水合不匹配，因 `showImageModal` 仅客户端交互）
  - 使用 `<Teleport to="body">` + `fixed inset-0 z-semi-modal bg-semi-overlay-dark` 全屏遮罩
  - 点击遮罩关闭模态（`@click="showImageModal = false"`），图片点击阻止冒泡（`@click.stop`）
  - 右上角关闭按钮 `w-10 h-10 rounded-full bg-semi-bg-0/20`
  - 图片 `max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-semi-lightbox`
  - 使用 `<Transition name="fade">` 过渡动画（`opacity` + `ease`，时长 `theme('transitionDuration.semi-normal')`）

#### Scenario: 图片生成成功展示结果

- **WHEN** `invocation.toolName === 'generateImage'`
- **AND** `invocation.state === 'output-available'`
- **AND** `isGenerateImageFailure(output)` 为 false
- **THEN** 组件 SHALL 渲染"AI 生成图片"头部 + 耗时 + seed
- **AND** SHALL 渲染图片缩略图（点击可放大）
- **AND** SHALL 渲染放大/下载/复制链接三个操作按钮

#### Scenario: 下载图片

- **WHEN** 用户点击下载按钮
- **THEN** SHALL 调用 `downloadImage(url, seed)` 通过 `fetch` + `blob` 触发下载
- **AND** 文件名 SHALL 为 `kolors-{seed}.png`
- **AND** fetch 失败时 SHALL 降级用 `<a download href target="_blank">` 直接打开

#### Scenario: 复制图片链接

- **WHEN** 用户点击"复制链接"按钮
- **THEN** SHALL 调用 `navigator.clipboard.writeText(url)` 复制图片 URL
- **AND** 按钮文案 SHALL 切换为"已复制" 1.5s 后恢复为"复制链接"
- **AND** 图标 SHALL 切换为对勾图标（`text-semi-success`）

#### Scenario: 点击缩略图放大查看

- **WHEN** 用户点击缩略图或"放大查看"按钮
- **THEN** `showImageModal` SHALL 设为 `true`
- **AND** SHALL 渲染全屏模态（`<ClientOnly>` + `<Teleport to="body">`）
- **AND** SHALL 显示原图（`max-w-[90vw] max-h-[90vh]`）
- **AND** 点击遮罩或关闭按钮 SHALL 关闭模态

#### Scenario: 图片生成失败展示错误

- **WHEN** `invocation.output.detail` 字段为 string
- **THEN** `isGenerateImageFailure(output)` SHALL 返回 true
- **AND** 组件 SHALL 渲染红色背景 + 错误图标 + `output.error` + `output.detail`
- **AND** SHALL 显示"等待 AI 自主决定是否重试..."提示

#### Scenario: ImgBB 转存失败但图片已生成

- **WHEN** `invocation.output.warning` 字段存在
- **THEN** 组件 SHALL 在图片下方渲染橙色警告背景（`bg-semi-warning-light`）+ 警告图标 + warning 文案

### Requirement: getVisibleToolInvocations 过滤逻辑

`pages/ai-chat.vue` SHALL 通过 `getVisibleToolInvocations(msg)` 函数基于前端开关过滤工具调用，决定哪些工具调用对用户可见。

- 函数 SHALL 调用 `getToolInvocations(msg)` 获取消息中所有工具调用（归一化后 toolName 一定存在）
- 函数 SHALL 基于以下开关过滤：
  - `webSearch` 工具：`enableWebSearch.value === false` 时过滤掉
  - `extractTextFromImage` 工具：`enableOcr.value === false` 时过滤掉
  - `generateImage` 工具：`enableImageGeneration.value === false` 时过滤掉
- **weather 工具无前端开关**：`weather` 与 `getCityByIp` 工具 SHALL 始终展示（不被任何开关过滤）
- 过滤后的工具调用数组 SHALL 传递给 `<LazyToolInvocation>` 组件渲染（`v-for="invocation in getVisibleToolInvocations(...)"`）
- 当过滤后数组为空时 SHALL 不渲染 ToolInvocation 容器（`v-if="getVisibleToolInvocations(...).length > 0"`）
- 虚拟列表 estimateSize 计算 SHALL 包含工具调用数量因素（`est += toolInvocations.length * 120`）
- **关键约束**：每新增工具类型 SHALL 同步在 `getVisibleToolInvocations` 中新增对应的开关过滤逻辑（若该工具有前端开关），无前端开关的工具（如 weather）应保持始终展示

#### Scenario: webSearch 开启时展示搜索工具调用

- **WHEN** `enableWebSearch.value === true`
- **AND** 消息中包含 `webSearch` 工具调用
- **THEN** `getVisibleToolInvocations` SHALL 返回包含该工具调用的数组
- **AND** 前端 SHALL 渲染对应 ToolInvocation 组件

#### Scenario: webSearch 关闭时隐藏搜索工具调用

- **WHEN** `enableWebSearch.value === false`
- **AND** 消息中包含 `webSearch` 工具调用
- **THEN** `getVisibleToolInvocations` SHALL 过滤掉该工具调用
- **AND** 前端 SHALL 不渲染对应 ToolInvocation 组件

#### Scenario: generateImage 开关过滤

- **WHEN** `enableImageGeneration.value === false`
- **AND** 消息中包含 `generateImage` 工具调用
- **THEN** `getVisibleToolInvocations` SHALL 过滤掉该工具调用

#### Scenario: OCR 开关过滤

- **WHEN** `enableOcr.value === false`
- **AND** 消息中包含 `extractTextFromImage` 工具调用
- **THEN** `getVisibleToolInvocations` SHALL 过滤掉该工具调用

#### Scenario: weather 工具始终展示

- **WHEN** 消息中包含 `weather` 工具调用
- **THEN** 无论任何前端开关状态，`getVisibleToolInvocations` SHALL 始终返回该工具调用
- **AND** 前端 SHALL 渲染对应 ToolInvocation 组件

#### Scenario: 过滤后无工具调用不渲染容器

- **WHEN** 消息中所有工具调用都被开关过滤掉
- **THEN** `getVisibleToolInvocations` SHALL 返回空数组
- **AND** 前端 SHALL 不渲染 ToolInvocation 容器（`v-if="...length > 0"` 为 false）

### Requirement: 触摸目标尺寸规范

`ToolInvocation.vue` 中的可交互元素 SHALL 满足触摸目标尺寸规范，适配手机和平板。

- 手机端（无前缀）纯图标按钮 SHALL 满足 `min-w-[36px] min-h-[36px]`
- 桌面端（`sm:` 前缀）SHALL 恢复默认尺寸（`sm:min-w-0 sm:min-h-0`）
- 输入区核心操作按钮（如复制、下载）SHALL 满足 `min-w-[44px] min-h-[44px]`
- 所有可点击元素 SHALL 添加 `active:scale-95` 或 `active:scale-[0.98]` 提供按压反馈
- generateImage 工具的操作按钮（放大/下载/复制链接）SHALL 使用 `w-7 h-7` 尺寸（28px，受空间限制的特例）+ `active:scale-95`
- generateImage 缩略图按钮 SHALL 使用 `active:scale-[0.98]` 提供按压反馈
- generateImage 模态框关闭按钮 SHALL 使用 `w-10 h-10` 尺寸 + `active:scale-95`
- 纯图标按钮 SHALL 使用 `v-tooltip` 提供文字提示，禁止使用原生 `title` 属性
- webSearch 结果项的 `<a>` 链接 SHALL 提供 `hover:text-semi-primary-active transition-colors` 悬浮反馈

#### Scenario: 手机端图标按钮触摸目标达标

- **WHEN** 在手机端（屏幕宽度 < 640px）渲染纯图标按钮
- **THEN** 按钮 SHALL 满足 `min-w-[36px] min-h-[36px]` 触摸目标尺寸
- **AND** SHALL 添加 `active:scale-95` 按压反馈

#### Scenario: 桌面端按钮恢复默认尺寸

- **WHEN** 在桌面端（屏幕宽度 ≥ 640px）渲染图标按钮
- **THEN** 按钮 SHALL 恢复默认尺寸（`sm:min-w-0 sm:min-h-0`）
- **AND** SHALL 保持 `active:scale-95` 按压反馈

#### Scenario: generateImage 操作按钮组尺寸

- **WHEN** 渲染 generateImage 工具的放大/下载/复制链接按钮
- **THEN** 按钮 SHALL 使用 `w-7 h-7` 固定尺寸
- **AND** SHALL 添加 `active:scale-95` 按压反馈
- **AND** SHALL 使用 `v-tooltip` 提供文字提示

#### Scenario: 纯图标按钮必须提供 tooltip

- **WHEN** 渲染无文字的纯图标按钮（如放大、下载、复制链接、关闭模态）
- **THEN** SHALL 使用 `v-tooltip` 提供文字提示
- **AND** SHALL NOT 使用原生 `title` 属性
