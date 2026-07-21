## Requirements

### Requirement: semi-* 命名空间集中管理设计令牌

`tailwind.config.js` SHALL 在 `theme.extend` 下统一使用 `semi-*` 命名空间扩展 Tailwind 默认主题，覆盖 `colors`、`spacing`、`borderRadius`、`fontSize`、`boxShadow`、`fontFamily`、`zIndex`、`transitionDuration`、`transitionTimingFunction` 共 9 个维度。命名空间采用「仅扩展不覆盖」原则，所有自定义令牌均加 `semi-` 前缀（颜色在 `colors.semi.*` 二级命名空间下），避免与 Tailwind 默认色板/间距/圆角冲突，可随时与 Tailwind 原生工具类混用。命名约定 SHALL 与 Semi Design 官方 CSS variable 一一对应（如 `--semi-color-primary` → `colors.semi.primary.DEFAULT`），便于查阅 Semi 官方文档。

#### Scenario: 所有自定义主题维度均位于 semi-* 命名空间下

- **WHEN** 审查 `tailwind.config.js` 的 `theme.extend` 对象
- **THEN** `colors.semi`、`spacing['semi-*']`、`borderRadius['semi-*']`、`fontSize['semi-*']`、`boxShadow['semi-*']`、`fontFamily.semi`、`zIndex['semi-*']`、`transitionDuration['semi-*']`、`transitionTimingFunction['semi-*']` 9 个维度全部存在
- **AND** `theme.extend` 中不存在未加 `semi-` 前缀的自定义颜色/间距/圆角覆盖项（不破坏 Tailwind 默认值）

#### Scenario: Semi 令牌与 Tailwind 原生工具类可混用

- **WHEN** 组件模板同时使用 `p-4`（Tailwind 默认间距）与 `p-semi-md`（Semi 自定义间距）
- **THEN** 两个类均生效，互不覆盖（`semi-*` 仅扩展不覆盖默认值）

#### Scenario: 命名与 Semi 官方 CSS variable 对齐

- **WHEN** 查阅 `colors.semi.primary.DEFAULT` 的值
- **THEN** 等于 `#0064FA`，对应 Semi 官方 `--semi-color-primary`
- **AND** `colors.semi.primary.hover` 对应 `--semi-color-primary-hover`、`colors.semi.primary.active` 对应 `--semi-color-primary-active`、`colors.semi.primary.light` 对应 `--semi-color-primary-light-default`

### Requirement: 颜色令牌覆盖语义色与中性色阶

`tailwind.config.js` 的 `colors.semi` SHALL 提供完整的颜色令牌体系，包含语义状态色、文本色阶、背景色阶、填充色阶、边框/分割线、遮罩层、Tooltip 浮层及代码块色板。

语义状态色 MUST 包含：
- `primary`：`DEFAULT=#0064FA`、`hover=#3D6DFA`、`active=#0050D9`、`light=#E5F3FF`（链接、主按钮、聚焦态）
- `success`：`DEFAULT=#00A870`、`light=#E6F6EE`
- `warning`：`DEFAULT=#FF7D00`、`light=#FFF1DE`
- `danger`：`DEFAULT=#F93920`、`light=#FDE6E2`
- `info`：`DEFAULT=#0064FA`、`light=#E5F3FF`

中性色阶 MUST 包含：
- `text`：`0=#1C1F23`（主文本）→ `1=#2C2E33` → `2=#41454D` → `3=#6B6F76`（弱化文本）
- `bg`：`0=#FFFFFF`（主背景）→ `1=#F8F8F8` → `2=#F2F2F2` → `3=#E5E5E5`（较深背景）
- `fill`：`0=#F9F9F9` → `1=#F2F2F2` → `2=#E5E5E5`（按钮 hover、菜单项 hover 填充）
- `border=#D9D9D9`、`divider=#E9E9E9`、`focus=#0064FA`

遮罩层 MUST 提供 `overlay=rgba(0,0,0,0.5)`、`overlay-subtle=rgba(0,0,0,0.4)`、`overlay-dark=rgba(0,0,0,0.8)` 以及 `hover-light=rgba(255,255,255,0.5)`、`hover-dark=rgba(0,0,0,0.05)`。

#### Scenario: 主色 primary 包含 DEFAULT / hover / active / light 四态

- **WHEN** 在组件中使用 `bg-semi-primary`、`bg-semi-primary-hover`、`bg-semi-primary-active`、`bg-semi-primary-light`
- **THEN** 分别渲染为 `#0064FA`、`#3D6DFA`、`#0050D9`、`#E5F3FF`

#### Scenario: 状态色 success/warning/danger/info 均有 DEFAULT 与 light 两态

- **WHEN** 在 Toast 组件中根据类型使用 `bg-semi-success-light`、`bg-semi-warning-light`、`bg-semi-danger-light`、`bg-semi-info-light`
- **THEN** 4 种浅色背景均可正确渲染（`#E6F6EE`、`#FFF1DE`、`#FDE6E2`、`#E5F3FF`）

#### Scenario: 文本色阶从主文本到弱化文本渐变

- **WHEN** 在组件中使用 `text-semi-text-0`、`text-semi-text-1`、`text-semi-text-2`、`text-semi-text-3`
- **THEN** 颜色依次为 `#1C1F23`、`#2C2E33`、`#41454D`、`#6B6F76`，从最深到最浅渐变

#### Scenario: 背景色阶覆盖主背景到较深背景

- **WHEN** 在卡片层级中使用 `bg-semi-bg-0`、`bg-semi-bg-1`、`bg-semi-bg-2`、`bg-semi-bg-3`
- **THEN** 颜色依次为 `#FFFFFF`、`#F8F8F8`、`#F2F2F2`、`#E5E5E5`

#### Scenario: 边框与分割线使用独立令牌

- **WHEN** 组件需要描边时使用 `border-semi-border`，需要分割线时使用 `border-semi-divider`
- **THEN** 分别渲染为 `#D9D9D9`（边框）与 `#E9E9E9`（更浅的分割线）

#### Scenario: 遮罩层按场景使用不同透明度

- **WHEN** 侧边栏遮罩使用 `bg-semi-overlay`、轻量级遮罩使用 `bg-semi-overlay-subtle`、深色对话框遮罩使用 `bg-semi-overlay-dark`
- **THEN** 三者透明度依次为 0.5、0.4、0.8

### Requirement: 行内代码使用柔和紫色令牌

`tailwind.config.js` 的 `colors.semi.code.inline` SHALL 固定为 `#7C3aed`（柔和紫色），`colors.semi.code.inline-bg` SHALL 固定为 `#F3F4F6`（浅紫背景）。组件中渲染行内代码 MUST 使用 `text-semi-code-inline` 与 `bg-semi-code-inline-bg` 令牌，禁止使用刺眼红色（如 `#e11d48`），以避免打断阅读节奏。此约束由 `AGENTS.md` 明确要求。

#### Scenario: 行内代码渲染为柔和紫色

- **WHEN** `MarkdownRenderer.vue` 渲染行内 `` `code` `` 片段
- **THEN** 文字颜色为 `#7C3aed`（`text-semi-code-inline`），背景色为 `#F3F4F6`（`bg-semi-code-inline-bg`）
- **AND** 不使用刺眼红色（如 `#e11d48`）作为行内代码颜色

#### Scenario: 代码块暗色主题色板独立配置

- **WHEN** 渲染代码块时使用 `colors.semi.code.dark` 子令牌
- **THEN** `bg=#1E1E1E`、`surface=#1F2937`、`border=#374151`、`text=#9CA3AF`、`text-strong=#F9FAFB`、`success=#34D399`（复制成功图标）均可用，独立于浅色中性色体系

### Requirement: 间距令牌基于 4px 栅格体系

`tailwind.config.js` 的 `theme.extend.spacing` SHALL 在 `semi-*` 命名空间下提供基于 4px 栅格的间距令牌，覆盖 `semi-xs`（4px）、`semi-sm`（8px）、`semi-sm-md`（10px，用于 Tooltip 水平 padding 等）、`semi-md`（12px）、`semi-base`（16px）、`semi-lg`（20px）、`semi-xl`（24px）、`semi-2xl`（32px）、`semi-3xl`（40px），并提供 `semi-sidebar=256px`（桌面端侧边栏固定宽度）。所有间距令牌与 Tailwind 默认 `spacing` 并行存在，互不覆盖。

#### Scenario: 使用语义化间距令牌

- **WHEN** 组件需要小间距时使用 `p-semi-sm`、中间距时使用 `p-semi-md`、大间距时使用 `p-semi-lg`
- **THEN** 分别渲染为 `padding: 8px`、`padding: 12px`、`padding: 20px`

#### Scenario: Tooltip 水平 padding 使用中间值 semi-sm-md

- **WHEN** Tooltip 组件需要介于 8px 与 12px 之间的水平内边距
- **THEN** 使用 `px-semi-sm-md` 渲染为 `padding-left/right: 10px`

#### Scenario: 桌面端侧边栏宽度使用专用令牌

- **WHEN** `SessionSidebar.vue` 在桌面端设置宽度
- **THEN** 使用 `w-semi-sidebar` 渲染为 `width: 256px`

### Requirement: 圆角令牌对应 Semi 组件约定

`tailwind.config.js` 的 `theme.extend.borderRadius` SHALL 在 `semi-*` 命名空间下提供与 Semi Design 组件圆角约定对齐的令牌：`semi-sm=3px`（按钮、Tag）、`semi-md=4px`（输入框、Select、Switch）、`semi-lg=8px`（Card、Modal 头部）、`semi-xl=12px`（Modal、Drawer）。圆角令牌与 Tailwind 默认 `rounded` 体系并行存在。

#### Scenario: 按钮与 Tag 使用小圆角 semi-sm

- **WHEN** 按钮或 Tag 组件使用 `rounded-semi-sm`
- **THEN** 渲染为 `border-radius: 3px`

#### Scenario: 输入框与 Select 使用中圆角 semi-md

- **WHEN** 输入框、Select、Switch 组件使用 `rounded-semi-md`
- **THEN** 渲染为 `border-radius: 4px`

#### Scenario: Modal 与 Drawer 使用最大圆角 semi-xl

- **WHEN** Modal 或 Drawer 组件使用 `rounded-semi-xl`
- **THEN** 渲染为 `border-radius: 12px`

### Requirement: 字体大小令牌采用语义化命名

`tailwind.config.js` 的 `theme.extend.fontSize` SHALL 在 `semi-*` 命名空间下提供语义化字号令牌，每项为 `[字号, { lineHeight, 字重 }]` 三元组，与 Semi 默认行高保持一致。MUST 包含以下令牌：
- `semi-micro`：10px / lineHeight 14px（天气小字、thinking 折叠状态等紧凑场景）
- `semi-micro-md`：11px / lineHeight 16px（输入框字数计数等）
- `semi-caption`：12px / lineHeight 20px
- `semi-body`：14px / lineHeight 20px
- `semi-body-lg`：16px / lineHeight 22px
- `semi-h5`：16px / lineHeight 22px / fontWeight 600
- `semi-h4`：18px / lineHeight 24px / fontWeight 600
- `semi-h3`：20px / lineHeight 24px / fontWeight 600
- `semi-h2`：24px / lineHeight 32px / fontWeight 600
- `semi-h1`：28px / lineHeight 36px / fontWeight 600

#### Scenario: 正文使用 semi-body 字号

- **WHEN** 聊天消息正文使用 `text-semi-body`
- **THEN** 渲染为 `font-size: 14px; line-height: 20px`

#### Scenario: 紧凑场景使用 semi-micro 字号

- **WHEN** 天气小字或 thinking 折叠状态使用 `text-semi-micro`
- **THEN** 渲染为 `font-size: 10px; line-height: 14px`

#### Scenario: 标题层级使用 semi-h1 到 semi-h5

- **WHEN** 页面标题使用 `text-semi-h1`、`text-semi-h2`、`text-semi-h3`、`text-semi-h4`、`text-semi-h5`
- **THEN** 字号依次为 28px / 24px / 20px / 18px / 16px，且均带 `fontWeight: 600`

### Requirement: 阴影令牌表达组件层级

`tailwind.config.js` 的 `theme.extend.boxShadow` SHALL 在 `semi-*` 命名空间下提供语义化阴影令牌，覆盖：
- `semi-elevated`：`0 0 0 1px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.08)`（提升态）
- `semi-card`：`0 0 0 1px rgba(0,0,0,0.04)`（卡片描边阴影）
- `semi-tooltip`：`0 2px 8px rgba(0,0,0,0.12)`（Tooltip 浮层）
- `semi-popover`：`0 2px 12px rgba(0,0,0,0.12)`（Popover 弹出层）
- `semi-tab`：`0 1px 2px rgba(0,0,0,0.06)`（Tab 切换阴影）
- `semi-lightbox`：`0 8px 32px rgba(0,0,0,0.4)`（Lightbox/图片预览深阴影）

#### Scenario: 卡片描边使用 semi-card 轻阴影

- **WHEN** Card 组件使用 `shadow-semi-card`
- **THEN** 渲染为 `0 0 0 1px rgba(0,0,0,0.04)`（仅 1px 描边，无 Y 轴偏移）

#### Scenario: Tooltip 浮层使用 semi-tooltip 阴影

- **WHEN** Tooltip 浮层使用 `shadow-semi-tooltip`
- **THEN** 渲染为 `0 2px 8px rgba(0,0,0,0.12)`

#### Scenario: Lightbox 图片预览使用 semi-lightbox 深阴影

- **WHEN** 图片预览 Lightbox 使用 `shadow-semi-lightbox`
- **THEN** 渲染为 `0 8px 32px rgba(0,0,0,0.4)`（明显的深度感）

### Requirement: z-index 令牌遵循 Semi 层级体系

`tailwind.config.js` 的 `theme.extend.zIndex` SHALL 在 `semi-*` 命名空间下提供与 Semi Design 官方层级规范对齐的 z-index 令牌（参考 https://semi.design/zh-CN/basic/tokens#z-index）。MUST 包含：
- `semi-modal=1000`（对话框、遮罩层）
- `semi-notification=1010`（Toast 通知）
- `semi-popover=1030`（弹出层浮层）
- `semi-dropdown=1050`（下拉菜单）
- `semi-tooltip=1060`（Tooltip 提示）

层级数值 MUST 按上述顺序递增，确保 Tooltip 永远浮于 Dropdown 之上，Dropdown 浮于 Popover 之上，以此类推。

#### Scenario: Tooltip 层级最高

- **WHEN** 同一页面同时存在 Modal、Dropdown、Tooltip
- **THEN** Tooltip 使用 `z-semi-tooltip`（1060）> Dropdown 使用 `z-semi-dropdown`（1050）> Modal 使用 `z-semi-modal`（1000）

#### Scenario: Toast 通知层级高于 Modal

- **WHEN** Toast 在 Modal 之上展示
- **THEN** Toast 使用 `z-semi-notification`（1010）> Modal 使用 `z-semi-modal`（1000）

#### Scenario: Popover 层级介于 Notification 与 Dropdown 之间

- **WHEN** Popover 浮层与 Notification、Dropdown 共存
- **THEN** Popover 使用 `z-semi-popover`（1030），介于 1010 与 1050 之间

### Requirement: 过渡时长令牌对应动画速度体系

`tailwind.config.js` 的 `theme.extend.transitionDuration` SHALL 在 `semi-*` 命名空间下提供 4 档过渡时长令牌，对应不同动画场景：
- `semi-instant=100ms`（微交互：hover、focus）
- `semi-fast=150ms`（按钮点击、颜色切换）
- `semi-normal=200ms`（面板展开、弹出）
- `semi-slow=300ms`（页面过渡、复杂动画）

`theme.extend.transitionTimingFunction` SHALL 同时提供 `semi-ease-in=cubic-bezier(0.4,0,1,1)`、`semi-ease-out=cubic-bezier(0,0,0.2,1)`、`semi-ease-in-out=cubic-bezier(0.4,0,0.2,1)` 三档缓动曲线。

#### Scenario: 微交互使用 semi-instant 时长

- **WHEN** 按钮 hover/focus 状态切换使用 `duration-semi-instant`
- **THEN** 过渡时长为 100ms

#### Scenario: 按钮点击使用 semi-fast 时长

- **WHEN** 按钮点击颜色切换使用 `duration-semi-fast`
- **THEN** 过渡时长为 150ms

#### Scenario: 面板展开使用 semi-normal 时长

- **WHEN** 侧边栏/面板展开使用 `duration-semi-normal`
- **THEN** 过渡时长为 200ms

#### Scenario: 页面过渡使用 semi-slow 时长

- **WHEN** 页面级过渡使用 `duration-semi-slow`
- **THEN** 过渡时长为 300ms

#### Scenario: 过渡时长令牌满足 UI/UX 规范约束

- **WHEN** 审查 `AGENTS.md` 中的 UI/UX 设计规范「过渡时长」章节
- **THEN** `semi-fast=150ms`、`semi-normal=200ms` 满足微交互 150-200ms 约束
- **AND** `semi-slow=300ms` 满足页面级动画 200-300ms 约束
- **AND** 所有令牌均不超过 500ms 上限

### Requirement: 暗色模式以代码块独立色板形式存在

`tailwind.config.js` 当前未启用 Tailwind 的 `darkMode: 'class'` 或 `darkMode: 'media'` 策略（即未配置 `darkMode` 字段），项目主题以浅色为默认。暗色场景 SHALL 以独立子令牌 `colors.semi.code.dark.*` 形式存在，专用于代码块暗色主题色板（`bg=#1E1E1E`、`surface=#1F2937`、`border=#374151`、`text=#9CA3AF`、`text-strong=#F9FAFB`、`success=#34D399`），独立于浅色中性色体系。若未来需要全局暗色模式，SHALL 在 `tailwind.config.js` 显式新增 `darkMode` 配置并补充对应的 `dark:` 变体令牌。

#### Scenario: 代码块暗色主题使用独立子令牌

- **WHEN** `CodeBlock.vue` 渲染代码块时使用 `bg-semi-code-dark-bg`、`bg-semi-code-dark-surface`、`text-semi-code-dark-text`
- **THEN** 分别渲染为 `#1E1E1E`、`#1F2937`、`#9CA3AF`，与浅色中性色体系互不干扰

#### Scenario: 当前未启用 Tailwind darkMode 策略

- **WHEN** 审查 `tailwind.config.js` 顶层配置
- **THEN** 不存在 `darkMode` 字段（默认行为，浅色主题）
- **AND** 组件中不应使用 `dark:` 变体类（当前无效果）

### Requirement: 设计令牌使用约束禁止 magic class

组件中 SHALL 使用 `semi-*` 设计令牌类（如 `bg-semi-primary`、`text-semi-text-0`、`p-semi-md`、`rounded-semi-lg`），禁止直接写 magic class（如 `bg-[#7c3aed]`、`text-[#1C1F23]`、`p-[12px]`、`rounded-[8px]`）。新增样式 MUST 优先复用已存在的 `semi-*` 令牌；若现有令牌无法满足需求，SHALL 先在 `tailwind.config.js` 的 `theme.extend` 对应 `semi-*` 命名空间下新增令牌，再在组件中使用。

特别约束：
- 行内代码颜色 MUST 使用 `text-semi-code-inline`（柔和紫色 `#7C3aed`），禁止使用刺眼红色（`#e11d48`）
- 所有可交互元素的过渡时长 MUST 使用 `duration-semi-*` 令牌，禁止使用 `duration-[150ms]` 等 magic value
- 所有浮层层级 MUST 使用 `z-semi-*` 令牌，禁止使用 `z-[1000]` 等 magic value

#### Scenario: 禁止在组件中使用 magic class 颜色

- **WHEN** 审查任意 `.vue` / `.ts` / `.js` 文件中的 className 或 class 属性
- **THEN** 不应出现 `bg-[#...]`、`text-[#...]`、`border-[#...]` 等 magic class 形式的颜色值
- **AND** 颜色相关样式应使用 `bg-semi-*`、`text-semi-*`、`border-semi-*` 令牌类

#### Scenario: 禁止在组件中使用 magic class 间距/圆角

- **WHEN** 审查组件中的间距与圆角类
- **THEN** 不应出现 `p-[12px]`、`m-[8px]`、`rounded-[8px]` 等 magic class 形式
- **AND** 应使用 `p-semi-md`、`m-semi-sm`、`rounded-semi-lg` 等令牌类

#### Scenario: 新增样式需求超出已有令牌范围时先扩展令牌

- **WHEN** 设计需要一种新的语义色（如 `accent`）或新的间距档位（如 `semi-4xl`）
- **THEN** 先在 `tailwind.config.js` 的 `theme.extend.colors.semi` 或 `theme.extend.spacing` 下新增对应令牌
- **AND** 在组件中使用新令牌类（如 `bg-semi-accent`、`p-semi-4xl`），而非直接写 magic class

#### Scenario: 行内代码颜色禁止使用刺眼红色

- **WHEN** 审查行内代码渲染相关代码
- **THEN** 不应出现 `#e11d48` 或 `text-[#e11d48]` 等刺眼红色样式
- **AND** 必须使用 `text-semi-code-inline` 令牌（柔和紫色 `#7C3aed`）
