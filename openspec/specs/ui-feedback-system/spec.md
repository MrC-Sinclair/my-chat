## Requirements

### Requirement: Toast 支持四种类型（success/error/info/warning）

`components/ToastProvider.vue` SHALL 支持 `success`、`error`、`info`、`warning` 四种 Toast 类型，每种类型对应不同的颜色主题（基于 `semi-*` 设计令牌）和图标字符。类型映射：`success` → 绿色（`bg-semi-success-light text-semi-success`）+ `✓` 图标；`error` → 红色（`bg-semi-danger-light text-semi-danger`）+ `✕` 图标；`info` → 蓝色（`bg-semi-info-light text-semi-info`）+ `ℹ` 图标；`warning` → 黄色（`bg-semi-warning-light text-semi-warning`）+ `⚠` 图标。`ToastItem` 类型 MUST 定义为 `{ id: number; message: string; type: 'success' | 'error' | 'info' | 'warning' }`。

#### Scenario: 显示 success 类型 Toast

- **WHEN** 调用 `toast.success("保存成功")`
- **THEN** ToastProvider 在右上角渲染一条绿色背景 Toast，左侧显示 `✓` 图标，右侧显示「保存成功」文本
- **AND** Toast 容器 class 包含 `bg-semi-success-light`、`text-semi-success`、`border-semi-success/30`

#### Scenario: 显示 error 类型 Toast

- **WHEN** 调用 `toast.error("请求失败")`
- **THEN** ToastProvider 渲染一条红色背景 Toast，左侧显示 `✕` 图标，右侧显示「请求失败」文本
- **AND** Toast 容器 class 包含 `bg-semi-danger-light`、`text-semi-danger`、`border-semi-danger/30`

#### Scenario: 显示 warning 类型 Toast

- **WHEN** 调用 `toast.warning("操作有风险")`
- **THEN** ToastProvider 渲染一条黄色背景 Toast，左侧显示 `⚠` 图标，右侧显示「操作有风险」文本
- **AND** Toast 容器 class 包含 `bg-semi-warning-light`、`text-semi-warning`、`border-semi-warning/30`

#### Scenario: 显示 info 类型 Toast

- **WHEN** 调用 `toast.info("提示信息")` 或 `toast.show("提示信息")`（不传 type 默认为 info）
- **THEN** ToastProvider 渲染一条蓝色背景 Toast，左侧显示 `ℹ` 图标，右侧显示「提示信息」文本
- **AND** Toast 容器 class 包含 `bg-semi-info-light`、`text-semi-info`、`border-semi-info/30`

### Requirement: Toast 自动消失（默认 3 秒，按类型差异化配置）

`ToastProvider.vue` 的 `show(message, type, duration)` 函数 SHALL 在指定 `duration` 毫秒后自动从 `toasts` 列表中移除该 Toast。默认 `duration = 3000` 毫秒。`success` 和 `info` 使用默认 3000ms；`error` 类型因需用户充分感知，固定使用 5000ms；`warning` 类型固定使用 4000ms。调用方可通过 `show(message, type, customDuration)` 显式覆盖默认时长。自动消失通过 `setTimeout` 实现，到期后用 `toasts.value.filter((t) => t.id !== id)` 不可变地移除。

#### Scenario: success Toast 默认 3 秒后消失

- **WHEN** 调用 `toast.success("操作成功")`（未传 duration）
- **THEN** Toast 立即显示在右上角
- **AND** 3000ms 后 Toast 从列表中移除并触发离场动画

#### Scenario: error Toast 默认 5 秒后消失

- **WHEN** 调用 `toast.error("网络错误")`（未传 duration）
- **THEN** Toast 立即显示
- **AND** 5000ms 后 Toast 自动移除（比 success 多 2 秒以便用户感知错误）

#### Scenario: warning Toast 默认 4 秒后消失

- **WHEN** 调用 `toast.warning("谨慎操作")`（未传 duration）
- **THEN** Toast 立即显示
- **AND** 4000ms 后 Toast 自动移除

#### Scenario: 自定义 duration 覆盖默认值

- **WHEN** 调用 `toast.show("停留 10 秒", "info", 10000)`
- **THEN** Toast 立即显示
- **AND** 10000ms 后 Toast 自动移除（自定义时长覆盖 info 默认 3000ms）

### Requirement: Toast 堆叠展示

`ToastProvider.vue` SHALL 使用 `flex flex-col gap-2` 布局让多个 Toast 在垂直方向堆叠展示，新 Toast 通过 `toasts.value.push(...)` 追加到列表末尾。每个 Toast MUST 拥有唯一递增 `id`（通过模块级 `nextId++` 生成），作为 `TransitionGroup` 的 `key`。容器定位为 `fixed top-4 right-4 z-semi-notification pointer-events-none`，单个 Toast 项恢复为 `pointer-events-auto` 以允许交互。最小宽度 `min-w-[200px]`、最大宽度 `max-w-[360px]`，避免过窄或过宽。

#### Scenario: 同时显示多条 Toast 垂直堆叠

- **WHEN** 先后调用 `toast.success("A")`、`toast.error("B")`、`toast.info("C")`（间隔极短）
- **THEN** 三条 Toast 同时显示在右上角，垂直方向以 `gap-2` 间距堆叠
- **AND** 每条 Toast 拥有唯一 `id`，按调用顺序从上到下排列
- **AND** 容器 `pointer-events-none`，但每条 Toast `pointer-events-auto` 不阻挡彼此点击

#### Scenario: 单条 Toast 离场不影响其他 Toast

- **WHEN** 列表中存在 3 条 Toast，第 1 条到达 duration 自动移除
- **THEN** 第 1 条触发离场动画消失
- **AND** 第 2、3 条保持原位不闪烁、不重排 key
- **AND** `TransitionGroup` 通过 `id` key 正确识别移除项

### Requirement: Toast Teleport 到 body 避免父组件裁剪

`ToastProvider.vue` SHALL 使用 `<Teleport to="body">` 将 Toast 容器传送到 `<body>` 下，避免被父组件的 `overflow: hidden`、`transform`、`z-index` 层叠上下文裁剪或遮挡。容器使用 `fixed top-4 right-4` 定位脱离文档流，`z-semi-notification` 层级确保浮于普通内容之上。`<slot />` MUST 保留在 Teleport 之外，确保子组件正常渲染在原 DOM 层级。

#### Scenario: 父组件设置 overflow:hidden 不裁剪 Toast

- **WHEN** ToastProvider 的某层祖先组件设置了 `overflow: hidden`
- **AND** 调用 `toast.success("提示")`
- **THEN** Toast 仍然显示在视口右上角，不被祖先容器裁剪
- **AND** Toast DOM 节点直接挂载在 `<body>` 下（而非祖先容器内）

#### Scenario: slot 内容渲染在原 DOM 层级

- **WHEN** 检查 ToastProvider 渲染的 DOM 结构
- **THEN** `<slot />` 渲染的内容（如 NuxtLayout）保留在原组件 DOM 层级
- **AND** 只有 Toast 容器被 Teleport 到 `<body>`

### Requirement: useToast composable API

`composables/useToast.ts` SHALL 通过 `inject('toast')` 从 ToastProvider 注入 Toast 操作对象，并导出 `{ show, success, error, info, warning }` 五个方法。API 签名 MUST 为：
- `show(message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number): void` — 通用方法，type 默认 `'info'`，duration 默认 `3000`
- `success(message: string): void` — 等价于 `show(message, 'success')`，固定 3000ms
- `error(message: string): void` — 等价于 `show(message, 'error', 5000)`，固定 5000ms
- `info(message: string): void` — 等价于 `show(message, 'info')`，固定 3000ms
- `warning(message: string): void` — 等价于 `show(message, 'warning', 4000)`，固定 4000ms

若 `inject('toast')` 返回 undefined（组件未在 ToastProvider 内使用），MUST 抛出 `Error('useToast must be used within ToastProvider')`。

#### Scenario: 在 ToastProvider 内调用 useToast 成功

- **WHEN** 子组件在 ToastProvider 内部，调用 `const toast = useToast()` 后调用 `toast.success("ok")`
- **THEN** 不抛异常
- **AND** ToastProvider 的 `show` 函数被调用，渲染对应 Toast

#### Scenario: 在 ToastProvider 外调用 useToast 抛错

- **WHEN** 组件未在 ToastProvider 内部（如根组件之外的孤立挂载），调用 `useToast()`
- **THEN** 抛出 `Error: useToast must be used within ToastProvider`
- **AND** 错误消息明确提示需要在 ToastProvider 内使用

#### Scenario: show 方法支持完整参数

- **WHEN** 调用 `toast.show("自定义", "warning", 6000)`
- **THEN** 渲染 warning 类型 Toast
- **AND** 6000ms 后自动消失

### Requirement: ConfirmDialog 替代原生 confirm/alert/prompt

项目 SHALL 禁止使用浏览器原生 `confirm()`、`alert()`、`prompt()` 对话框（在 Android WebView 中风格不协调且可能被拦截），所有需要用户确认的场景（特别是删除、重命名等危险操作）MUST 使用 `useConfirmDialog()` 弹窗确认。`components/ConfirmDialogProvider.vue` 提供自定义确认对话框，标题、消息、按钮文本均使用项目设计令牌（`semi-*`），与整体视觉风格一致。

#### Scenario: 删除操作必须使用 ConfirmDialog

- **WHEN** 用户点击「删除会话」按钮
- **THEN** 调用 `const ok = await useConfirmDialog().open({ title: '删除会话', message: '...' })`
- **AND** 弹出自定义 ConfirmDialog 等待用户确认
- **AND** 代码中不出现 `confirm(...)` 原生调用

#### Scenario: 不允许使用 alert 提示

- **WHEN** 检查项目源码（.vue / .ts 文件）
- **THEN** 不存在 `alert(...)` 调用
- **AND** 用户提示通过 `useToast()` 或 ConfirmDialog 实现

### Requirement: ConfirmDialog API（open 返回 Promise<boolean>）

`composables/useConfirmDialog.ts` SHALL 通过 `inject('confirmDialog')` 注入对话框操作对象，导出 `{ open }` 方法。API 签名 MUST 为 `open(opts: { title?: string; message: string }): Promise<boolean>`。`title` 可选，默认为「确认」；`message` 必填。返回 Promise，用户点击确认按钮 resolve `true`，点击取消按钮或遮罩层 resolve `false`。ConfirmDialogProvider 内部通过 `_resolve` 函数引用持有 Promise 的 resolve，在 `confirm()` / `cancel()` 触发时调用。

#### Scenario: 调用 open 传入完整参数

- **WHEN** 调用 `dialog.open({ title: '删除会话', message: '此操作不可恢复，确认删除？' })`
- **THEN** 弹出对话框，标题显示「删除会话」，消息显示「此操作不可恢复，确认删除？」
- **AND** 返回一个 pending 的 Promise<boolean>

#### Scenario: 调用 open 省略 title 使用默认值

- **WHEN** 调用 `dialog.open({ message: '确认继续？' })`
- **THEN** 弹出对话框，标题显示默认值「确认」
- **AND** 消息显示「确认继续？」

#### Scenario: 未在 ConfirmDialogProvider 内调用抛错

- **WHEN** 组件未在 ConfirmDialogProvider 内部，调用 `useConfirmDialog()`
- **THEN** 抛出 `Error: useConfirmDialog must be used within ConfirmDialogProvider`

### Requirement: ConfirmDialog 异步等待用户操作

`open()` 返回的 Promise SHALL 保持 pending 状态直到用户点击「确认删除」或「取消」按钮（或点击遮罩层）。调用方 MUST 使用 `await dialog.open(...)` 等待用户决策，基于返回的 `boolean` 决定后续流程。`visible` ref 在 open 时置为 `true` 显示对话框，在 confirm/cancel 时置为 `false` 隐藏对话框并调用 `_resolve`。

#### Scenario: 用户点击确认按钮 resolve true

- **WHEN** 调用 `const ok = await dialog.open({ message: '确认删除？' })` 后用户点击「确认删除」按钮
- **THEN** 对话框关闭（`visible` 置为 false）
- **AND** Promise resolve `true`
- **AND** `ok` 变量值为 `true`，调用方继续执行删除逻辑

#### Scenario: 用户点击取消按钮 resolve false

- **WHEN** 调用 `const ok = await dialog.open({ message: '确认删除？' })` 后用户点击「取消」按钮
- **THEN** 对话框关闭
- **AND** Promise resolve `false`
- **AND** `ok` 变量值为 `false`，调用方中止删除流程

#### Scenario: 用户点击遮罩层 resolve false

- **WHEN** 对话框显示后用户点击遮罩层（非对话框内容区域）
- **THEN** 触发 `@click.self="cancel"`，对话框关闭
- **AND** Promise resolve `false`（与点击取消按钮行为一致）

### Requirement: ConfirmDialog Teleport 到 body + 半透明遮罩

`ConfirmDialogProvider.vue` SHALL 使用 `<Teleport to="body">` 将对话框传送到 `<body>` 下，避免父组件层叠上下文影响。遮罩层定位为 `fixed inset-0 z-semi-modal flex items-center justify-center bg-semi-overlay-subtle`，覆盖整个视口并使用半透明背景色（`semi-overlay-subtle`）阻挡底层交互。遮罩层 MUST 通过 `@click.self="cancel"` 监听点击事件，仅当点击目标为遮罩层本身（非对话框内容）时触发 cancel。对话框内容居中展示，宽度 `min-w-[320px] max-w-[420px] mx-4`，圆角 `rounded-xl`，阴影 `shadow-semi-popover`，背景 `bg-semi-bg-0`。

#### Scenario: 对话框 Teleport 到 body 不被父组件遮挡

- **WHEN** ConfirmDialogProvider 的祖先组件设置了 `transform` 或 `z-index` 层叠上下文
- **AND** 调用 `dialog.open(...)` 显示对话框
- **THEN** 对话框 DOM 节点直接挂载在 `<body>` 下
- **AND** 遮罩层覆盖整个视口（`fixed inset-0`），对话框居中显示在遮罩层之上

#### Scenario: 点击遮罩层空白区域关闭对话框

- **WHEN** 对话框显示，用户点击对话框内容之外的遮罩层空白区域
- **THEN** `@click.self` 判定点击目标是遮罩层本身，触发 `cancel()`
- **AND** 对话框关闭，Promise resolve `false`

#### Scenario: 点击对话框内容不关闭

- **WHEN** 用户点击对话框内部的标题、消息、按钮之外的空白区域
- **THEN** `@click.self` 判定点击目标不是遮罩层（`event.target` ≠ 遮罩层元素），不触发 cancel
- **AND** 对话框保持显示

### Requirement: Provider 在 app.vue 全局注册

`app.vue` SHALL 在模板中嵌套注册 `ToastProvider` 与 `ConfirmDialogProvider`，确保全局可用。注册顺序 MUST 为：`<ToastProvider>`（最外层）→ `<ConfirmDialogProvider>` → `<NuxtLayout>` → `<NuxtPage>`。此顺序确保任何页面/组件内调用 `useToast()` 或 `useConfirmDialog()` 都能通过 `inject` 拿到对应 Provider 提供的对象。两个 Provider 内部均通过 `provide('toast', ...)` / `provide('confirmDialog', ...)` 向后代注入 API。

#### Scenario: 任意页面调用 useToast 不报错

- **WHEN** 在 `pages/ai-chat.vue` 或任意页面组件中调用 `useToast()`
- **THEN** inject 成功返回 `{ show, success, error, info, warning }` 对象
- **AND** 不抛 `useToast must be used within ToastProvider` 错误

#### Scenario: 任意页面调用 useConfirmDialog 不报错

- **WHEN** 在任意页面或子组件中调用 `useConfirmDialog()`
- **THEN** inject 成功返回 `{ open }` 对象
- **AND** 不抛 `useConfirmDialog must be used within ConfirmDialogProvider` 错误

#### Scenario: Provider 嵌套顺序正确

- **WHEN** 检查 app.vue 模板结构
- **THEN** ToastProvider 是最外层，ConfirmDialogProvider 嵌套在 ToastProvider 内部
- **AND** NuxtLayout 嵌套在 ConfirmDialogProvider 内部
- **AND** 两个 Provider 都使用 `<slot />` 渲染子内容

### Requirement: 触摸设备适配（点击反馈 active:scale-95）

ConfirmDialog 的「取消」和「确认删除」按钮 SHALL 提供 `active:scale-95` 点击反馈，配合 `transition-all` 平滑过渡，为触摸设备提供按压感。按钮样式为 `px-4 py-2 text-sm font-medium rounded-lg`，hover 时背景色加深（`hover:bg-semi-fill-2` / `hover:bg-semi-danger`）。取消按钮使用 `text-semi-text-2 bg-semi-fill-1`，确认删除按钮使用 `text-white bg-semi-danger`。所有可点击元素 MUST 提供视觉反馈（active scale 或 hover bg 变化），禁止无反馈的等待。

#### Scenario: 点击确认按钮有按压反馈

- **WHEN** 用户按下「确认删除」按钮（触摸设备 touchstart 或鼠标 mousedown）
- **THEN** 按钮立即应用 `active:scale-95` 变换，视觉上缩小至 95%
- **AND** 松开后通过 `transition-all` 平滑恢复原大小

#### Scenario: 点击取消按钮有按压反馈

- **WHEN** 用户按下「取消」按钮
- **THEN** 按钮应用 `active:scale-95` 变换
- **AND** hover 状态下背景色从 `bg-semi-fill-1` 变为 `bg-semi-fill-2`

#### Scenario: API 请求失败必须 Toast 反馈而非静默

- **WHEN** 任意 API 请求失败（catch 分支）
- **THEN** 调用 `toast.error(...)` 向用户展示错误信息
- **AND** 禁止仅 `console.error` 静默处理而不弹 Toast

### Requirement: 过渡动画（Toast translateX + opacity，ConfirmDialog scale + opacity）

Toast 与 ConfirmDialog SHALL 使用 `<TransitionGroup>` / `<Transition>` 实现入场/离场过渡动画。Toast 使用 `name="toast"` 的 `TransitionGroup`，入场动画为 `translateX(-semi-3xl)` + `opacity: 0` → `translateX(0)` + `opacity: 1`（从左侧滑入），时长使用 `theme('transitionDuration.semi-slow')`（ease-out）；离场动画反向，时长 `semi-normal`（ease-in）。ConfirmDialog 使用双层 Transition：遮罩层 `name="confirm-overlay"` 仅 opacity 过渡（`semi-normal` 入场，`semi-fast` 离场）；对话框内容 `name="confirm-dialog" appear` 使用 `scale(0.95) translateY(semi-sm)` + `opacity: 0` → `scale(1) translateY(0)` + `opacity: 1`（缩放 + 上浮），时长 `semi-normal` 入场，`semi-fast` 离场。所有过渡时长 MUST 控制在 150-300ms 区间，禁止超过 500ms。

#### Scenario: Toast 入场从左侧滑入

- **WHEN** 调用 `toast.success("ok")` 触发 Toast 入场
- **THEN** Toast 从 `translateX(-semi-3xl)` + `opacity: 0` 状态开始
- **AND** 通过 `semi-slow` 时长（约 200-300ms）ease-out 过渡到 `translateX(0)` + `opacity: 1`
- **AND** 视觉上表现为从左侧滑入右上角定位点

#### Scenario: Toast 离场向左滑出

- **WHEN** Toast 达到 duration 自动移除
- **THEN** Toast 从当前位置过渡到 `translateX(-semi-3xl)` + `opacity: 0`
- **AND** 时长为 `semi-normal`（约 150-200ms）ease-in

#### Scenario: ConfirmDialog 遮罩层淡入淡出

- **WHEN** 调用 `dialog.open(...)` 显示对话框
- **THEN** 遮罩层从 `opacity: 0` 过渡到 `opacity: 1`，时长 `semi-normal`
- **AND** 关闭时遮罩层从 `opacity: 1` 过渡到 `opacity: 0`，时长 `semi-fast`

#### Scenario: ConfirmDialog 对话框缩放上浮入场

- **WHEN** 对话框显示（`visible` 置为 true）
- **THEN** 对话框内容通过 `appear` 触发首次入场动画
- **AND** 从 `scale(0.95) translateY(semi-sm)` + `opacity: 0` 过渡到 `scale(1) translateY(0)` + `opacity: 1`
- **AND** 时长为 `semi-normal` ease-out，视觉上表现为轻微缩放并向上浮动

#### Scenario: 操作成功必须用 toast.success 反馈

- **WHEN** 删除、重命名等操作成功完成
- **THEN** 调用 `toast.success(...)` 显示绿色 Toast 反馈成功
- **AND** 禁止操作成功后无任何用户反馈

### Requirement: 错误处理与成功反馈强制使用 Toast

所有 API 请求失败 MUST 通过 `useToast().error(...)` 向用户展示错误信息，禁止仅 `console.error` 静默处理。删除、重命名等操作成功后 MUST 使用 `toast.success(...)` 反馈。此规则与 `AGENTS.md` 的「用户反馈系统」章节一致：错误提示不能仅 console.error，操作成功必须 toast.success。Toast 系统通过 `ToastProvider`（在 `app.vue` 中注册）+ `useToast()` composable 使用，支持 `success` / `error` / `info` / `warning` 四种类型。

#### Scenario: API 请求失败必须 Toast 反馈而非静默

- **WHEN** 任意 API 请求失败（catch 分支）
- **THEN** 调用 `toast.error(...)` 向用户展示错误信息
- **AND** 禁止仅 `console.error` 静默处理而不弹 Toast

#### Scenario: 危险操作必须 ConfirmDialog 确认

- **WHEN** 用户触发删除会话、清空消息等危险操作
- **THEN** 调用 `await useConfirmDialog().open(...)` 弹窗等待用户确认
- **AND** 禁止无确认直接执行删除
- **AND** 用户取消时不执行删除

#### Scenario: 操作成功后 toast.success 反馈

- **WHEN** 删除、重命名等操作成功完成
- **THEN** 调用 `toast.success(...)` 显示绿色 Toast 反馈成功
- **AND** 禁止操作成功后无任何用户反馈
