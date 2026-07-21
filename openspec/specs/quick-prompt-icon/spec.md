## Requirements

### Requirement: QuickPromptIcon 支持 6 种内置图标类型

`components/chat/QuickPromptIcon.vue` SHALL 接受 `icon` prop（联合字面量类型 `'sun' | 'image' | 'flow' | 'palette' | 'globe' | 'mail'`），在单个 `<svg>` 根元素内通过 `v-if / v-else-if` 分支渲染对应的内联 SVG 图标。6 种图标分别对应：`sun`（太阳/天气，中心圆 + 8 条放射线）、`image`（图片/圆角矩形 + 圆点 + 山形曲线）、`flow`（流程图/两个方块与连接线）、`palette`（调色板/不规则主体 + 4 个色点）、`globe`（地球/外圆 + 经纬线）、`mail`（信封/矩形 + 折叠口曲线）。SVG 根元素 MUST 统一使用 `viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`stroke-width="1.8"`、`stroke-linecap="round"`、`stroke-linejoin="round"` 的描边样式。

#### Scenario: 渲染 sun 图标

- **WHEN** 父组件传入 `icon="sun"`
- **THEN** 组件渲染中心 `<circle cx="12" cy="12" r="4" />` 与 8 条放射 `<path>`（上/下/左/右/4 条对角线）
- **AND** SVG 根元素 viewBox 为 `0 0 24 24`，stroke 为 `currentColor`，stroke-width 为 `1.8`

#### Scenario: 渲染 image 图标

- **WHEN** 父组件传入 `icon="image"`
- **THEN** 组件渲染 `<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />` 外框、`<circle cx="9" cy="9" r="2" />` 圆点、`m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21` 山形曲线

#### Scenario: 渲染 flow 图标

- **WHEN** 父组件传入 `icon="flow"`
- **THEN** 组件渲染两个 `<rect width="6" height="6" rx="1" />`（左上 `x="3" y="3"`、右下 `x="15" y="15"`）以及连接它们的多段 `<path>` 曲线与节点圆点

#### Scenario: 渲染 palette 图标

- **WHEN** 父组件传入 `icon="palette"`
- **THEN** 组件渲染 4 个带 `fill="currentColor"` 的小圆点（`cx/cy` 分布于 `6.5–17.5` 之间）以及调色板主体 `<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688...">`

#### Scenario: 渲染 globe 图标

- **WHEN** 父组件传入 `icon="globe"`
- **THEN** 组件渲染 `<circle cx="12" cy="12" r="10" />` 外圆、`<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />` 经线以及 `<path d="M2 12h20" />` 赤道

#### Scenario: 渲染 mail 图标

- **WHEN** 父组件传入 `icon="mail"`
- **THEN** 组件渲染 `<rect width="20" height="16" x="2" y="4" rx="2" />` 信封外框和 `<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />` 折叠信封口曲线

### Requirement: QuickPromptIcon 为纯 SVG 模板组件（无 script 逻辑）

`QuickPromptIcon.vue` MUST 仅由 `<script setup lang="ts">`（仅含 `defineProps` 类型声明）和 `<template>`（仅 `<svg>` + `v-if/v-else-if` 分支）组成，不包含任何响应式状态（`ref`/`reactive`/`computed`）、生命周期钩子（`onMounted`/`onUnmounted`）、方法或 watcher。组件不维护任何内部状态，所有渲染完全由 `icon` prop 单向驱动。

#### Scenario: script 块仅声明 props 类型

- **WHEN** 检查 `QuickPromptIcon.vue` 的 `<script setup lang="ts">` 块
- **THEN** 仅存在 `defineProps<{ icon: 'sun' | 'image' | 'flow' | 'palette' | 'globe' | 'mail' }>()` 一行声明
- **AND** 不存在 `ref`、`reactive`、`computed`、`watch`、`onMounted`、`onUnmounted` 等组合式 API 调用

#### Scenario: template 仅渲染 SVG 元素

- **WHEN** 检查 `QuickPromptIcon.vue` 的 `<template>` 块
- **THEN** 根元素为单个 `<svg>`，内部仅包含 `<template v-if/v-else-if>` 分支与 SVG 子元素（`<circle>`、`<path>`、`<rect>`）
- **AND** 不存在 `<div>`、`<span>` 等额外 HTML 包装元素或文本节点

### Requirement: 点击快捷提示卡片触发对应 prompt 并直接发送

`pages/ai-chat.vue` SHALL 维护 `quickPrompts: Array<{ icon: PromptIconType; title: string; prompt: string }>` 配置数组，包含 6 项内置快捷提示（`sun`→天气查询、`image`→图片渲染、`flow`→Mermaid 流程图、`palette`→复杂图文混排、`globe`→翻译成英文、`mail`→商务邮件）。当用户点击任意快捷提示卡片时，触发 `useQuickPrompt(prompt.prompt)` 函数：将对应 `prompt` 文本赋值到 `input.value`，并在 `nextTick` 回调中调用 `wrappedHandleSubmit()` 直接提交发送，不经过额外的「追加/编辑」中间态。

#### Scenario: 点击快捷卡片直接发送对应 prompt

- **WHEN** 用户点击 icon 为 `sun` 的快捷卡片
- **THEN** `input.value` 被设为「请调用 weather 工具查询我所在城市的实时天气，并简要告诉我：当前温度、体感温度、天气状况、以及是否需要带伞」
- **AND** `nextTick` 之后 `wrappedHandleSubmit()` 被调用，消息被直接发送至 `/api/chat`
- **AND** 不展示中间编辑态，输入框内容即被消费

#### Scenario: 6 项内置快捷提示配置完整

- **WHEN** 检查 `pages/ai-chat.vue` 中的 `quickPrompts` 数组
- **THEN** 数组长度为 6
- **AND** 6 项的 `icon` 字段依次为 `sun`、`image`、`flow`、`palette`、`globe`、`mail`，与 QuickPromptIcon 支持的 6 种类型一一对应
- **AND** 每项均包含非空 `title`（卡片显示文案）和非空 `prompt`（点击后发送的文本）

### Requirement: 快捷提示卡片触摸目标尺寸满足移动端可达性

快捷提示卡片按钮 MUST 在手机端（默认断点 < 640px）设置 `min-h-[48px]`（≥ 36px 触摸目标阈值），桌面端（`sm:` 断点 ≥ 640px）提升为 `sm:min-h-[60px]`。卡片内部图标圆形容器 MUST 在手机端为 `w-9 h-9`（36px，满足纯图标按钮 ≥ 36px 规则），桌面端为 `sm:w-10 sm:h-10`（40px）。父容器布局采用 `grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3`，手机端单列、桌面端双列。

#### Scenario: 手机端触摸目标满足 36px 阈值

- **WHEN** 在视口宽度 < 640px 的设备上渲染快捷提示卡片
- **THEN** 卡片按钮的最小高度为 `min-h-[48px]`（≥ 36px）
- **AND** 图标圆形容器尺寸为 `w-9 h-9`（36px，满足触摸目标规则）
- **AND** 卡片以单列 `grid-cols-1` 排列，间距为 `gap-2`

#### Scenario: 桌面端提升至更大尺寸

- **WHEN** 在视口宽度 ≥ 640px 的设备上渲染快捷提示卡片
- **THEN** 卡片按钮最小高度提升至 `sm:min-h-[60px]`
- **AND** 图标圆形容器尺寸提升至 `sm:w-10 sm:h-10`（40px）
- **AND** 卡片以双列 `sm:grid-cols-2` 排列，间距为 `sm:gap-3`

### Requirement: 卡片 hover 时提供视觉反馈

快捷提示卡片 MUST 在 hover 时通过 `transition-all duration-semi-normal` 平滑过渡，应用以下视觉变化：边框颜色 `hover:border-semi-primary/30`、阴影提升 `hover:shadow-semi-elevated`、轻微上移 `hover:-translate-y-0.5`、背景 `hover:bg-semi-bg-0`。卡片内图标圆形容器 MUST 在父卡片 hover 时通过 `group-hover:scale-105` 与 `transition-transform duration-semi-normal` 平滑放大，形成联动反馈。整体过渡时长由设计 token `duration-semi-normal` 统一约束，对应微交互 150–200ms 区间，禁止瞬间跳变。

#### Scenario: hover 卡片时多属性同步变化

- **WHEN** 用户鼠标悬停在任意快捷提示卡片上
- **THEN** 卡片边框色变为 `border-semi-primary/30`
- **AND** 卡片阴影提升为 `shadow-semi-elevated`
- **AND** 卡片向上位移 `0.5` 单位（`-translate-y-0.5`）
- **AND** 图标圆形容器缩放至 `scale-105`
- **AND** 所有属性变化以 `duration-semi-normal`（150–200ms 区间）平滑过渡

#### Scenario: 鼠标移出后平滑恢复

- **WHEN** 用户鼠标移出卡片
- **THEN** 卡片边框、阴影、位移、图标缩放均恢复至默认状态
- **AND** 恢复过程同样使用 `transition-all duration-semi-normal` 平滑过渡，无硬切

### Requirement: 卡片 active 时提供按压反馈

快捷提示卡片 MUST 在被按下（active）时应用 `active:scale-[0.98]`，通过约 2% 的轻微缩放提供按压触觉反馈，避免点击无反馈的等待感。该反馈与 `transition-all` 共同作用，按下时平滑收缩、释放时平滑回弹。

#### Scenario: 按下卡片时缩放

- **WHEN** 用户在卡片上按下鼠标或触摸按下
- **THEN** 卡片缩放至 `scale-[0.98]`（约 2% 收缩）
- **AND** 缩放通过 `transition-all` 平滑过渡，无瞬间跳变

#### Scenario: 释放后平滑回弹

- **WHEN** 用户释放鼠标或触摸
- **THEN** 卡片缩放恢复至 `scale-100`
- **AND** 回弹过程同样使用 `transition-all` 平滑过渡

### Requirement: 快捷提示图标统一使用内联 SVG，禁止 Unicode 字符

`QuickPromptIcon.vue` 与 `pages/ai-chat.vue` 的快捷提示模块 MUST 全部使用内联 SVG 图标（通过 `QuickPromptIcon` 组件渲染），禁止使用任何 Unicode 字符（如 `☰`、`✕`、`☀`、`✉` 等）或 emoji 作为图标占位。所有 6 种图标 MUST 通过 SVG 几何元素（`<circle>`、`<path>`、`<rect>`）绘制，描边样式统一为 `stroke="currentColor"`、`stroke-width="1.8"`、`stroke-linecap="round"`、`stroke-linejoin="round"`，确保视觉一致性。

#### Scenario: 6 种图标均由 SVG 几何元素绘制

- **WHEN** 检查 `QuickPromptIcon.vue` 模板的 6 个图标分支
- **THEN** 每个分支（sun/image/flow/palette/globe/mail）仅包含 `<circle>`、`<path>`、`<rect>` SVG 元素
- **AND** 不存在任何 Unicode 字符或 emoji 字符作为图标

#### Scenario: 父组件统一通过组件引用图标

- **WHEN** 检查 `pages/ai-chat.vue` 中快捷提示卡片模板
- **THEN** 图标通过 `<QuickPromptIcon :icon="prompt.icon" ... />` 渲染
- **AND** 不存在内联硬编码的 Unicode 字符替代图标
