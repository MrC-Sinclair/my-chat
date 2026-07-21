## Requirements

### Requirement: 使用 useVirtualizer 实现消息列表虚拟滚动

`pages/ai-chat.vue` SHALL 使用 `@tanstack/vue-virtual` 的 `useVirtualizer` hook 创建虚拟滚动器，处理长会话消息列表的渲染性能问题。虚拟滚动器 MUST 通过 `computed()` 包裹配置对象，确保 `count`、`getScrollElement`、`estimateSize`、`measureElement`、`overscan`、`gap` 等选项响应式更新。`count` MUST 绑定到 `messages.value.length`，`getScrollElement` MUST 返回消息容器 DOM 引用（`messagesContainer.value`）。容器外层 MUST 设置 `height: virtualizer.getTotalSize() px`、`position: relative`，虚拟项 MUST 设置 `position: absolute`、`top: 0`、`left: 0`、`width: 100%`，并通过 `transform: translateY(${virtualRow.start}px)` 定位到虚拟滚动器计算的位置。虚拟项 MUST 通过 `:ref` 回调在挂载时调用 `virtualizer.measureElement(el)` 上报实际高度，并设置 `data-index` 属性便于高度记录。

#### Scenario: 消息数量较多时仅渲染可视区域及 overscan 范围内的虚拟项

- **WHEN** 会话包含 200 条消息，但可视区域仅能显示 5 条
- **THEN** `virtualizer.getVirtualItems()` 仅返回当前可视区域加上 `overscan` 范围内的虚拟项（约 10 条）
- **AND** DOM 中通过 `v-for` 渲染的消息元素数量与 `getVirtualItems()` 返回长度一致，不渲染全部 200 条

#### Scenario: 消息数量动态变化时虚拟滚动器配置响应式更新

- **WHEN** 用户发送新消息导致 `messages.value.length` 从 5 变为 6
- **THEN** `useVirtualizer` 的 `computed` 配置重新计算，`count` 更新为 6
- **AND** `getTotalSize()` 返回值相应增大，容器高度调整

#### Scenario: 虚拟项通过 transform 定位到正确位置

- **WHEN** 虚拟滚动器渲染第 N 个虚拟项
- **THEN** 该虚拟项的 `transform` CSS 属性被设置为 `translateY(${virtualRow.start}px)`
- **AND** `position: absolute`、`top: 0`、`left: 0`、`width: 100%` 保证虚拟项在容器内正确定位

### Requirement: 动态高度测量（measureElement 测量每条消息实际高度）

`pages/ai-chat.vue` SHALL 通过 `measureElement` 选项实现动态高度测量，使虚拟滚动器在消息实际渲染后获取真实高度而非依赖估计值。`measureElement` 回调 MUST 通过 `element.getBoundingClientRect().height` 读取元素实际高度，并从 `element.dataset.index` 提取虚拟项索引。每条消息在挂载时 MUST 通过 `:ref` 回调主动调用 `virtualizer.measureElement(el)`，确保首屏渲染后立即上报真实高度。`remeasureAllItems()` 函数 SHALL 通过 `virtualizerParentRef.value.querySelectorAll('[data-index]')` 查询所有已渲染的虚拟项，遍历调用 `measureElement` 重新测量高度。

#### Scenario: 消息首次渲染后上报真实高度

- **WHEN** 一条新消息被虚拟滚动器渲染并挂载到 DOM
- **THEN** `:ref` 回调立即调用 `virtualizer.measureElement(el)`
- **AND** `measureElement` 选项回调读取 `element.getBoundingClientRect().height` 作为该虚拟项的真实高度
- **AND** 虚拟滚动器使用该真实高度重新计算 `getTotalSize()` 和后续虚拟项的 `start` 位置

#### Scenario: 重新测量所有已渲染虚拟项的高度

- **WHEN** 调用 `remeasureAllItems()`
- **THEN** 函数通过 `querySelectorAll('[data-index]')` 查询当前所有已渲染的虚拟项 DOM
- **AND** 遍历每个元素调用 `virtualizer.measureElement(el)` 重新上报高度
- **AND** 非流式期间额外调用 `virtualizer.measure()` 触发全局重新计算

#### Scenario: estimateSize 在 measureElement 测量前提供初始估计高度

- **WHEN** 虚拟项尚未挂载到 DOM，`measureElement` 未被调用
- **THEN** `estimateSize` 选项根据消息类型和内容估算初始高度：用户消息固定 80px，AI 消息按文本长度（`Math.ceil(text.length / 30) * 24`）累加并加上思考过程（120px）和工具调用（每个 120px）的预留空间
- **AND** 估算值限制在 120px ~ 800px 区间内，避免极端值

### Requirement: 高度只增不减策略（避免流式期间测量抖动）

`pages/ai-chat.vue` SHALL 在 `measureElement` 回调中实现"高度只增不减"策略，避免流式输出期间 MarkdownRenderer 重新渲染的中间状态导致测量值回退引发滚动抖动。`lastMeasuredHeights`（`Map<number, number>`）MUST 记录每个虚拟项索引的历史最大测量高度。`measureElement` 回调 MUST 通过 `Math.max(h, lastH)` 取当前测量值与历史记录的最大值作为上报高度，并更新 `lastMeasuredHeights`。会话切换时 MUST 在 `watch(currentSessionId)` 中调用 `lastMeasuredHeights.clear()` 清空记录，避免旧会话的高度记录干扰新会话的测量。

#### Scenario: 流式期间 MarkdownRenderer 中间状态读到较小高度时取历史最大值

- **WHEN** 流式输出期间某虚拟项当前 `getBoundingClientRect().height` 为 200px
- **AND** `lastMeasuredHeights` 中该索引记录的历史高度为 300px
- **THEN** `measureElement` 回调返回 `Math.max(200, 300) = 300px` 作为上报高度
- **AND** `lastMeasuredHeights` 中该索引记录保持 300px 不变
- **AND** `getTotalSize()` 不回退，避免容器高度减小触发浏览器自动调整 `scrollTop` 导致抖动

#### Scenario: 消息实际高度增长时更新历史记录

- **WHEN** 某虚拟项当前测量高度为 350px，历史记录为 300px
- **THEN** `measureElement` 回调返回 350px
- **AND** `lastMeasuredHeights.set(idx, 350)` 更新历史记录为 350px

#### Scenario: 会话切换时清空高度历史记录

- **WHEN** 用户切换会话触发 `watch(currentSessionId)` 回调
- **THEN** `lastMeasuredHeights.clear()` 清空所有虚拟项的历史高度记录
- **AND** 新会话的虚拟项重新从 `estimateSize` 估计值开始测量，不受旧会话记录干扰

### Requirement: 自动滚动到底部（消息数量变化和 AI 流式输出时）

`pages/ai-chat.vue` SHALL 在消息数量增加和 AI 流式输出时自动滚动到底部，确保用户始终看到最新内容。`scrollToBottom()` 函数 MUST 先调用 `enableStickToBottom()` 启用滚动锁定，然后在 `nextTick` 中调用 `virtualizer.value.scrollToIndex(messages.value.length - 1, { align: 'end', behavior: 'auto' })` 滚动到最后一条消息。`watch(messages.value.length)` MUST 在新消息数量大于旧消息数量时调用 `scrollToBottom()`。AI 流式输出期间（`isLoading.value === true`），`watch(最后一条消息文本)` MUST 直接设置 `scroll.scrollTop = scroll.scrollHeight` 跟随底部，不使用 `virtualizer.scrollToIndex` 以避免与 `scheduleRemeasure` 中的 `measure()` 冲突导致 `getTotalSize` 抖动。流式结束时（`watch(isLoading)` 由 true 变 false）若 `stickToBottom` 为 true，MUST 调用 `scrollToBottom()` 归位。

#### Scenario: 用户发送新消息后自动滚动到底部

- **WHEN** `messages.value.length` 从 5 变为 6（用户发送新消息）
- **THEN** `watch` 回调检测到 `newLen > oldLen`，调用 `scrollToBottom()`
- **AND** `scrollToBottom` 启用 `stickToBottom` 并通过 `virtualizer.scrollToIndex(5, { align: 'end', behavior: 'auto' })` 滚动到最后一条消息

#### Scenario: AI 流式输出期间直接设置 scrollTop 跟随底部

- **WHEN** `isLoading.value === true` 且最后一条消息的文本内容发生变化
- **THEN** `watch` 回调启用 `stickToBottom` 并直接设置 `messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight`
- **AND** 不调用 `virtualizer.scrollToIndex`，避免触发 virtualizer 内部计算与 `scheduleRemeasure` 冲突导致抖动

#### Scenario: 流式结束时归位滚动到底部

- **WHEN** `isLoading` 从 true 变为 false
- **AND** `stickToBottom` 为 true（用户未主动上滑）
- **THEN** `watch(isLoading)` 回调调用 `scrollToBottom()` 归位
- **AND** 通过 `virtualizer.scrollToIndex` 平滑定位到最后一条消息

### Requirement: 流式输出期间滚动锁定（用户手动上滑时不强制滚回底部）

`pages/ai-chat.vue` SHALL 实现滚动锁定机制，当用户在流式输出期间主动向上滚动查看历史消息时，不强制将视图滚回底部。`stickToBottom` 标志位 MUST 默认为 false，仅在 `enableStickToBottom()` 被调用时置为 true，并在 2500ms 后自动重置为 false（通过 `stickToBottomTimer` 防抖）。消息容器 MUST 通过 `ResizeObserver` 监听尺寸变化触发 `virtualizer.measure()`，并通过 `scroll` 事件监听器（`passive: true`）检测用户滚动行为。`scroll` 事件回调 MUST 计算 `scrollHeight - scrollTop - clientHeight < 50` 判断是否在底部附近，若不在底部附近则将 `stickToBottom` 置为 false 并清除防抖定时器。流式结束时的 `scrollToBottom()` 调用 MUST 受 `stickToBottom` 标志位约束，用户主动上滑后不强制归位。

#### Scenario: 用户在流式期间主动向上滚动查看历史

- **WHEN** AI 正在流式输出（`isLoading` 为 true）
- **AND** 用户主动向上滚动导致 `scrollHeight - scrollTop - clientHeight >= 50`
- **THEN** `scroll` 事件回调将 `stickToBottom` 置为 false，清除 `stickToBottomTimer`
- **AND** 后续流式输出的 `watch(最后一条消息文本)` 虽然仍设置 `scrollTop = scrollHeight`，但流式结束时 `watch(isLoading)` 因 `stickToBottom === false` 不调用 `scrollToBottom()`
- **AND** 用户的视图保持在历史消息位置，不被强制打断

#### Scenario: 用户停留在底部时保持滚动锁定

- **WHEN** `enableStickToBottom()` 被调用，`stickToBottom` 置为 true
- **AND** 用户未主动滚动，`scroll` 事件回调判断仍在底部附近（`< 50`）
- **THEN** `stickToBottom` 保持 true，不被重置
- **AND** 2500ms 后 `stickToBottomTimer` 自动将其重置为 false

#### Scenario: 用户在 2500ms 内重新回到底部

- **WHEN** `stickToBottom` 因用户上滑被置为 false
- **AND** 用户在 2500ms 内重新滚动到底部附近（`< 50`）
- **THEN** 后续 `enableStickToBottom()` 调用可重新启用 `stickToBottom`（如新消息到达）
- **AND** `stickToBottomTimer` 通过 `clearTimeout` 清除旧定时器并重新计时

### Requirement: overscan 预渲染避免滚动边缘空白

`pages/ai-chat.vue` SHALL 在 `useVirtualizer` 配置中设置 `overscan: 5`，在虚拟列表可视区域外预渲染 5 条消息，避免快速滚动时出现空白区域。`overscan` 值 MUST 通过 `computed` 配置传入虚拟滚动器，与 `count`、`estimateSize`、`measureElement` 等选项一同响应式更新。预渲染的虚拟项 MUST 与可视区域内的虚拟项采用相同的渲染逻辑（包括 `:ref` 调用 `measureElement`、`data-index` 属性、`transform` 定位），确保滚动到边缘时无需重新挂载。

#### Scenario: 快速滚动时预渲染区域填充内容避免空白

- **WHEN** 用户快速向下滚动消息列表
- **THEN** `virtualizer.getVirtualItems()` 返回的虚拟项集合包含可视区域下方 5 条预渲染项
- **AND** 滚动过程中下方边缘不会出现空白区域，预渲染项已提前挂载到 DOM

#### Scenario: overscan 区域内的虚拟项同样被测量高度

- **WHEN** 预渲染的虚拟项挂载到 DOM
- **THEN** `:ref` 回调调用 `virtualizer.measureElement(el)` 上报其真实高度
- **AND** `measureElement` 选项回调通过 `Math.max(h, lastH)` 应用"高度只增不减"策略记录其高度
- **AND** 当用户滚动使这些项进入可视区域时，高度已正确测量无需重新计算

<!-- 注：原 AGENTS.md 规则要求「使用 <TransitionGroup> 包裹消息列表，入场动画 translateY(12px) + opacity」，
     但虚拟滚动用 position: absolute + transform: translateY(virtualRow.start) 定位，与 TransitionGroup 的 transform 过渡
     存在架构层面冲突（transform 互相覆盖、虚拟项卸载打断离场动画、流式输出期间 measureElement 重算加剧抖动）。
     经评估决策，AGENTS.md 已修订为「禁止使用 <TransitionGroup> 包裹虚拟滚动列表」，消息到达反馈通过自动滚动 + overscan + 流式打字机提供。
     如需新增入场动画，应使用不依赖 transform 的方案（如 opacity-only CSS animation）。 -->
