## Requirements

### Requirement: 桌面端内联侧边栏布局

`pages/ai-chat.vue` SHALL 在 `sm:` 断点以上（视口宽度 ≥ 640px）将 `SessionSidebar` 组件内联在页面 flex 流中，不使用 `fixed` 定位，不影响主内容区域的文档流。桌面端侧边栏外层容器 MUST 使用 `hidden sm:flex` 类（手机端隐藏、桌面端显示）。展开/收起通过 `<Transition name="sidebar">` 包裹，使用 `v-show="showSidebar"` 控制显隐（非 `v-if`，以保留组件内部状态）。过渡动画同时操作 `margin-left`（在 `0` 与 `calc(theme('spacing.semi-sidebar') * -1)` 之间）和 `opacity`（0 ↔ 1），时长由 Tailwind 主题令牌 `theme('transitionDuration.semi-slow')` 定义（200-300ms 范围），缓动函数为 `ease`。

#### Scenario: 桌面端展开侧边栏

- **WHEN** 视口宽度 ≥ 640px 且 `showSidebar` 从 `false` 切换为 `true`
- **THEN** `<Transition name="sidebar">` 触发 `sidebar-enter-active` 过渡
- **AND** 侧边栏容器从 `margin-left: calc(theme('spacing.semi-sidebar') * -1)` + `opacity: 0` 过渡到 `margin-left: 0` + `opacity: 1`
- **AND** 过渡时长为 `theme('transitionDuration.semi-slow')`（200-300ms 范围）
- **AND** 主内容区域随侧边栏展开平滑调整可用宽度

#### Scenario: 桌面端收起侧边栏

- **WHEN** 视口宽度 ≥ 640px 且 `showSidebar` 从 `true` 切换为 `false`
- **THEN** `<Transition name="sidebar">` 触发 `sidebar-leave-active` 过渡
- **AND** 侧边栏容器 `margin-left` 过渡到负的 `theme('spacing.semi-sidebar')` 值，`opacity` 过渡到 0
- **AND** 主内容区域平滑扩展占满剩余空间

#### Scenario: 桌面端初始渲染默认显示侧边栏

- **WHEN** 页面在桌面端（≥640px）首次加载并执行 `onMounted`
- **THEN** `isMobile.value = false`，`showSidebar.value = !isMobile.value` 为 `true`
- **AND** 侧边栏在 flex 流中默认可见

#### Scenario: 桌面端侧边栏不使用 fixed 定位

- **WHEN** 检查桌面端侧边栏外层容器的 class
- **THEN** 容器使用 `hidden sm:flex`（内联在 flex 流中）
- **AND** 不包含 `fixed`、`inset-0`、`z-50` 等覆盖式定位类
- **AND** 不渲染半透明遮罩层

### Requirement: 手机端覆盖式弹出层布局

`pages/ai-chat.vue` SHALL 在手机端（视口宽度 < 640px）将侧边栏渲染为覆盖式弹出层，使用 `<Transition name="slide-left">` 包裹。弹出层结构 MUST 为两层嵌套：
- 外层遮罩容器：`fixed inset-0 z-50 sm:hidden` + 半透明遮罩背景（`bg-semi-overlay`，效果等同于 `bg-black/50`），覆盖整个视口
- 内层侧边栏面板：`absolute inset-y-0 left-0 w-[85vw]` + `bg-semi-bg-1`，从左侧贴边渲染，宽度为视口的 85%

弹出层 MUST 通过 `v-if="showSidebar"` 控制挂载（非 `v-show`），确保关闭时完全从 DOM 移除。`.slide-left` 动画通过 `transform: translateX(-100%)` 实现从左侧滑入效果，同时配合 `opacity` 过渡。外层遮罩容器 MUST 携带 `data-mobile-sidebar` 属性，供 `onDocumentClick` 全局监听器识别侧边栏边界。

#### Scenario: 手机端打开侧边栏

- **WHEN** 视口宽度 < 640px 且 `showSidebar` 从 `false` 切换为 `true`
- **THEN** `<Transition name="slide-left">` 触发 `slide-left-enter-active` 过渡
- **AND** 外层遮罩容器以 `fixed inset-0 z-50` 覆盖整个视口，背景为 `bg-semi-overlay`
- **AND** 内层侧边栏面板从 `translateX(-100%)` + `opacity: 0` 平移到 `translateX(0)` + `opacity: 1`
- **AND** 过渡时长为 250ms（0.25s），缓动函数为 `ease`
- **AND** 侧边栏面板宽度为 `85vw`

#### Scenario: 手机端关闭侧边栏

- **WHEN** 视口宽度 < 640px 且 `showSidebar` 从 `true` 切换为 `false`
- **THEN** `<Transition name="slide-left">` 触发 `slide-left-leave-active` 过渡
- **AND** 侧边栏面板从 `translateX(0)` + `opacity: 1` 平移到 `translateX(-100%)` + `opacity: 0`
- **AND** 动画结束后整个弹出层（外层遮罩 + 内层面板）从 DOM 移除（`v-if` 控制）

#### Scenario: 手机端初始渲染默认隐藏侧边栏

- **WHEN** 页面在手机端（<640px）首次加载并执行 `onMounted`
- **THEN** `isMobile.value = true`，`showSidebar.value = !isMobile.value` 为 `false`
- **AND** 侧边栏弹出层不在 DOM 中（`v-if` 为 false）

#### Scenario: 手机端侧边栏面板宽度限制

- **WHEN** 手机端侧边栏弹出层渲染
- **THEN** 内层面板宽度为 `w-[85vw]`（视口宽度的 85%）
- **AND** 右侧留出 15% 视口宽度显示半透明遮罩，提示用户点击可关闭

### Requirement: isMobile 响应式断点判断

`pages/ai-chat.vue` SHALL 通过 `window.innerWidth < 640` 判断设备类型，结果存储在 `isMobile` ref 中。`isMobile` 的初始值 MUST 为 `false`（SSR 安全默认值），真实值 MUST 在 `onMounted` 生命周期中延迟赋值。组件 MUST 在 `onMounted` 中注册 `resize` 事件监听器，在 `onUnmounted` 中通过 `removeEventListener` 移除监听器，确保窗口尺寸变化时同步更新 `isMobile`。`onResize` 函数引用 MUST 在模块作用域定义为 `null`，在 `onMounted` 中赋值为真实函数，以便 `onUnmounted` 安全判断是否需要移除监听器。

#### Scenario: SSR 阶段 isMobile 为默认值

- **WHEN** 组件在服务端渲染
- **THEN** `isMobile.value` 为 `false`（不访问 `window` 对象）
- **AND** 不产生水合不匹配警告

#### Scenario: 客户端挂载时初始化 isMobile

- **WHEN** 组件在客户端 `onMounted` 执行
- **THEN** 读取 `window.innerWidth`，若 `< 640` 则 `isMobile.value = true`，否则 `isMobile.value = false`
- **AND** 同时设置 `showSidebar.value = !isMobile.value`（桌面端默认显示，手机端默认隐藏）

#### Scenario: 窗口尺寸变化时同步更新

- **WHEN** 用户调整浏览器窗口尺寸触发 `resize` 事件
- **THEN** 重新计算 `mobile = window.innerWidth < 640`
- **AND** 更新 `isMobile.value = mobile`
- **AND** 若从手机端切换到桌面端（`!mobile`）且当前 `showSidebar.value` 为 `false`，则自动设置 `showSidebar.value = true`（桌面端默认显示）

#### Scenario: 组件卸载时移除 resize 监听器

- **WHEN** 组件触发 `onUnmounted`
- **THEN** 若 `onResize` 不为 `null`，调用 `window.removeEventListener('resize', onResize)` 移除监听器
- **AND** 不产生内存泄漏

#### Scenario: 手机端切换会话时自动关闭侧边栏

- **WHEN** `currentSessionId` 变化（用户切换会话）
- **AND** `isMobile.value` 为 `true`
- **THEN** `showSidebar.value = false` 自动关闭侧边栏
- **AND** 桌面端（`isMobile.value === false`）不受影响，侧边栏保持打开状态

### Requirement: 手机端侧边栏关闭按钮

手机端覆盖式弹出层内的 `SessionSidebar` 组件 SHALL 自带 X 关闭按钮，点击后向父组件 emit `close` 事件。`pages/ai-chat.vue` MUST 在手机端弹出层的 `<LazySessionSidebar>` 上监听 `@close="closeSidebar"` 事件，调用 `closeSidebar()` 函数将 `showSidebar.value` 置为 `false`。关闭按钮 MUST 满足触摸目标 ≥ 36px 的可访问性要求。桌面端内联侧边栏 MUST NOT 渲染 X 关闭按钮（桌面端通过 header 中的 toggle 按钮控制显隐）。

#### Scenario: 点击 X 按钮关闭手机端侧边栏

- **WHEN** 用户在手机端点击 `SessionSidebar` 内的 X 关闭按钮
- **THEN** `SessionSidebar` emit `close` 事件
- **AND** `pages/ai-chat.vue` 接收事件后调用 `closeSidebar()`，`showSidebar.value = false`
- **AND** 触发 `slide-left-leave-active` 动画，侧边栏从左侧滑出

#### Scenario: 桌面端不渲染 X 关闭按钮

- **WHEN** 视口宽度 ≥ 640px
- **THEN** 桌面端内联侧边栏（`hidden sm:flex` 容器内的 `LazySessionSidebar`）不监听 `@close` 事件
- **AND** 桌面端通过 header 中的 toggle 按钮（`toggleSidebar`）控制显隐

### Requirement: 点击遮罩关闭侧边栏

手机端覆盖式弹出层的外层遮罩容器 SHALL 监听点击事件，当点击目标为遮罩自身（非侧边栏面板内部子元素）时关闭侧边栏。MUST 使用 `@click.self="closeSidebar"` 修饰符确保仅点击遮罩本身时触发，点击侧边栏面板内部不会冒泡关闭。此外，组件 SHALL 注册 `document` 级别的全局点击监听器 `onDocumentClick`，作为手机端点击主内容区域关闭侧边栏的补充机制。

#### Scenario: 点击遮罩空白区域关闭侧边栏

- **WHEN** 视口宽度 < 640px，侧边栏已打开
- **AND** 用户点击侧边栏面板外部的半透明遮罩区域（`fixed inset-0` 容器的空白部分）
- **THEN** `@click.self` 修饰符匹配，触发 `closeSidebar()`
- **AND** `showSidebar.value = false`，侧边栏通过 `slide-left-leave-active` 动画滑出

#### Scenario: 点击侧边栏内部不关闭

- **WHEN** 视口宽度 < 640px，侧边栏已打开
- **AND** 用户点击侧边栏面板内部（如会话列表项、按钮等子元素）
- **THEN** `@click.self` 修饰符不匹配（点击目标不是遮罩容器本身）
- **AND** 不触发 `closeSidebar()`，侧边栏保持打开状态

#### Scenario: 点击主内容区域关闭侧边栏（全局监听兜底）

- **WHEN** 视口宽度 < 640px，侧边栏已打开
- **AND** 用户点击主内容区域（非 header、非 `[data-mobile-sidebar]` 内部）
- **THEN** `onDocumentClick` 全局监听器触发
- **AND** 检测到 `showSidebar.value === true` 且 `window.innerWidth < 640`
- **AND** 点击目标 `closest('header')` 为 `null` 且 `closest('[data-mobile-sidebar]')` 为 `null`
- **AND** 设置 `showSidebar.value = false` 关闭侧边栏

#### Scenario: 点击 header 区域不关闭侧边栏

- **WHEN** 视口宽度 < 640px，侧边栏已打开
- **AND** 用户点击 header 区域（如 toggle 按钮、新建会话按钮）
- **THEN** `onDocumentClick` 检测到 `target.closest('header')` 不为 `null`
- **AND** 不关闭侧边栏（交由 header 内按钮自行处理）

### Requirement: 响应式断点定义

项目 SHALL 使用 Tailwind CSS 默认的 `sm:` 断点（640px）作为手机端与平板/桌面端的分界线。手机端样式无前缀（如 `hidden`、`fixed`、`inset-0`、`bg-semi-overlay`），平板/桌面端样式加 `sm:` 前缀（如 `sm:flex`、`sm:hidden`）。项目同时支持 Android 平板横屏和手机竖屏两种设备形态，通过同一套断点规则统一适配。

#### Scenario: 手机端样式无 sm: 前缀

- **WHEN** 视口宽度 < 640px
- **THEN** 应用无前缀的 Tailwind 类（如 `fixed inset-0 z-50`、`hidden`、`bg-semi-overlay`）
- **AND** `sm:` 前缀的类不生效
- **AND** 手机端侧边栏弹出层可见（`sm:hidden` 不生效），桌面端内联侧边栏隐藏（`hidden` 生效）

#### Scenario: 平板/桌面端样式加 sm: 前缀

- **WHEN** 视口宽度 ≥ 640px
- **THEN** `sm:` 前缀的类生效（如 `sm:flex`、`sm:hidden`）
- **AND** 手机端侧边栏弹出层因 `sm:hidden` 而隐藏
- **AND** 桌面端内联侧边栏因 `sm:flex` 而显示

#### Scenario: 同时适配 Android 平板横屏与手机竖屏

- **WHEN** 设备为 Android 平板横屏（宽度通常 ≥ 768px）
- **THEN** 走桌面端内联布局（`sm:flex` 生效）
- **AND** 侧边栏内联在 flex 流中，可通过 toggle 按钮展开/收起
- **WHEN** 设备为手机竖屏（宽度通常 < 640px）
- **THEN** 走手机端覆盖式弹出层布局（无前缀类生效）
- **AND** 侧边栏作为覆盖式弹出层从左侧滑入

### Requirement: 侧边栏过渡动画规格

侧边栏 SHALL 在桌面端和手机端使用不同的过渡动画类。桌面端使用 `.sidebar` 过渡类（操作 `margin-left` + `opacity`），手机端使用 `.slide-left` 过渡类（操作 `transform: translateX` + `opacity`）。动画时长 MUST 在项目 UI/UX 规范定义的页面级动画 200-300ms 范围内。所有过渡 MUST 使用 CSS `transition` 属性实现，不使用 JavaScript 动画，避免阻塞主线程。

#### Scenario: 桌面端 sidebar 过渡动画

- **WHEN** 桌面端 `showSidebar` 切换触发 `<Transition name="sidebar">`
- **THEN** 应用 `.sidebar-enter-active` 或 `.sidebar-leave-active` 过渡
- **AND** 同时过渡 `margin-left`（在 `0` 与 `calc(theme('spacing.semi-sidebar') * -1)` 之间）和 `opacity`（0 ↔ 1）
- **AND** 过渡时长为 `theme('transitionDuration.semi-slow')`（200-300ms 范围）
- **AND** 缓动函数为 `ease`

#### Scenario: 手机端 slide-left 过渡动画

- **WHEN** 手机端 `showSidebar` 切换触发 `<Transition name="slide-left">`
- **THEN** 应用 `.slide-left-enter-active` 或 `.slide-left-leave-active` 过渡
- **AND** 同时过渡 `transform`（在 `translateX(-100%)` 与 `translateX(0)` 之间）和 `opacity`（0 ↔ 1）
- **AND** 过渡时长为 250ms（0.25s）
- **AND** 缓动函数为 `ease`

#### Scenario: 过渡动画不阻塞主线程

- **WHEN** 侧边栏过渡动画执行中
- **THEN** 使用 CSS `transition` 属性（非 JavaScript `requestAnimationFrame` 动画）
- **AND** 不阻塞主线程，主内容区域的滚动和交互保持响应

### Requirement: SSR 水合安全

`pages/ai-chat.vue` SHALL 确保侧边栏相关状态在 SSR 和客户端首次渲染时输出一致的 HTML，避免水合不匹配（Hydration Mismatch）警告或错误。所有依赖浏览器 API（`window`、`document`、`navigator`）的值 MUST 在 `onMounted` 中延迟赋值，`ref` 初始值 MUST 为 SSR 安全的默认值。`isMobile` 初始值 MUST 为 `false`（不访问 `window`），`showSidebar` 初始值由 `useChatConfig` 提供（默认为 `true`），在 `onMounted` 中根据 `isMobile` 真实值重新赋值。`resize` 事件监听器 MUST 仅在客户端 `onMounted` 中注册，不在 SSR 阶段访问 `window`。

#### Scenario: SSR 输出与客户端首次渲染一致

- **WHEN** 页面在服务端渲染
- **THEN** `isMobile.value` 为 `false`（不访问 `window`）
- **AND** `showSidebar.value` 为 `useChatConfig` 的初始值（`true`）
- **AND** SSR 输出的 HTML 中桌面端侧边栏容器存在（`hidden sm:flex`）
- **AND** 手机端弹出层因 `v-if="showSidebar"` 为 `true` 也被渲染到 HTML（但 `sm:hidden` 使其在桌面端不可见）
- **AND** 客户端首次渲染输出相同 HTML，不产生水合不匹配警告

#### Scenario: onMounted 后延迟赋值真实状态

- **WHEN** 组件在客户端挂载完成（`onMounted` 执行）
- **THEN** `isMobile.value` 被赋值为 `window.innerWidth < 640` 的真实结果
- **AND** `showSidebar.value` 被赋值为 `!isMobile.value`（手机端关闭、桌面端打开）
- **AND** 此后状态变化触发的 DOM 更新通过 Vue 响应式系统正常进行，不影响已水合的节点

#### Scenario: resize 监听器仅在客户端注册

- **WHEN** 组件在 SSR 阶段执行
- **THEN** 不访问 `window.addEventListener`（`window` 不存在）
- **AND** `onResize` 函数引用保持为 `null`
- **AND** `onUnmounted` 中通过 `if (onResize)` 守卫安全跳过 `removeEventListener` 调用

#### Scenario: 浏览器 API 访问守卫

- **WHEN** 检查 `pages/ai-chat.vue` 的 `<script setup>` 中对 `window`、`document` 的访问
- **THEN** 所有 `window.innerWidth`、`window.addEventListener`、`document.addEventListener` 调用都位于 `onMounted` 回调内部
- **AND** 不在 `<script setup>` 顶层或 `computed` 中直接访问浏览器 API
- **AND** 不在模板中直接使用 `window` 或 `document` 表达式
