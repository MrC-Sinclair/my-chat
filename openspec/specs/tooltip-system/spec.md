## Requirements

### Requirement: v-tooltip 自定义指令注册为 Vue 全局指令

项目 SHALL 通过 `plugins/tooltip.ts` 中的 `defineNuxtPlugin` 将 `composables/useTooltip.ts` 导出的 `tooltipDirective` 注册为全局 Vue 指令 `v-tooltip`，使所有组件无需 import 即可使用 `v-tooltip="text"` 绑定。指令 MUST 实现 `mounted` / `updated` / `unmounted` / `getSSRProps` 四个钩子。指令通过设置元素的 `data-tooltip` 与 `data-tooltip-position` data 属性向 CSS 暴露状态，自身不直接操作 DOM 样式或浮层定位。`useTooltip()` composable SHALL 导出 `{ vTooltip: tooltipDirective }` 供非全局场景手动绑定。

#### Scenario: 组件使用 v-tooltip 字符串绑定

- **WHEN** 在任意 `.vue` 组件模板中写 `<button v-tooltip="复制">复制</button>`
- **THEN** 运行时该 button 元素的 DOM 上被设置 `data-tooltip="复制"` 属性
- **AND** 不设置 `data-tooltip-position` 属性（默认 top）

#### Scenario: 组件使用 v-tooltip:bottom 指定方向

- **WHEN** 在模板中写 `<button v-tooltip:bottom="'更多操作'">...</button>`
- **THEN** 元素 DOM 上同时被设置 `data-tooltip="更多操作"` 与 `data-tooltip-position="bottom"` 两个属性

#### Scenario: 全局指令在 Nuxt 应用启动时自动注册

- **WHEN** Nuxt 应用启动并加载 `plugins/tooltip.ts`
- **THEN** `nuxtApp.vueApp.directive('tooltip', tooltipDirective)` 被调用一次
- **AND** 所有后续渲染的组件均可直接使用 `v-tooltip` 而无需局部 import

#### Scenario: 测试环境同步注册指令以消除警告

- **WHEN** 运行 Vitest 单元测试，组件渲染时使用 `v-tooltip`
- **THEN** `tests/setup.ts` 通过 `config.global.directives = { tooltip: tooltipDirective }` 全局注册同一指令
- **AND** 测试控制台不出现 "Failed to resolve directive: tooltip" 警告

### Requirement: SSR 安全避免水合不匹配

`tooltipDirective` SHALL 实现 `getSSRProps` 钩子，在服务端渲染阶段返回与客户端 `mounted` 钩子设置完全一致的 DOM 属性集合，确保 SSR 输出 HTML 与客户端水合后的 DOM 携带相同的 `data-tooltip` / `data-tooltip-position` 属性，从而避免 Nuxt 3 水合不匹配（Hydration Mismatch）警告。`getSSRProps` MUST 不返回任何交互行为或样式对象，仅返回纯展示属性的字符串 map。当 `binding.value` 为空字符串或 falsy 时，`getSSRProps` MUST 返回空对象 `{}`，不向 SSR DOM 注入任何属性。

#### Scenario: SSR 渲染时注入与客户端一致的 data-tooltip 属性

- **WHEN** SSR 阶段渲染 `<button v-tooltip="复制">复制</button>`
- **THEN** `getSSRProps` 返回 `{ 'data-tooltip': '复制' }`
- **AND** 服务端输出的 HTML 中 button 元素已携带 `data-tooltip="复制"` 属性
- **AND** 客户端 `mounted` 钩子执行后 DOM 上属性与之完全一致，不触发水合不匹配警告

#### Scenario: SSR 阶段非 top 位置同步注入 data-tooltip-position

- **WHEN** SSR 阶段渲染 `<button v-tooltip:bottom="'提示'">...</button>`
- **THEN** `getSSRProps` 返回 `{ 'data-tooltip': '提示', 'data-tooltip-position': 'bottom' }`

#### Scenario: binding.value 为空时 getSSRProps 返回空对象

- **WHEN** SSR 阶段渲染 `<button v-tooltip="">按钮</button>`（value 为空字符串）
- **THEN** `getSSRProps` 返回空对象 `{}`
- **AND** 服务端输出的 HTML 不携带任何 `data-tooltip*` 属性

### Requirement: 纯 CSS 浮层实现（无 JS 定位计算）

Tooltip 浮层 SHALL 完全由 `assets/css/tooltip.css` 中的 CSS 伪元素实现，禁止任何 JavaScript 浮层定位计算（如 `getBoundingClientRect`、动态 `top/left` 注入、Popper.js 等）。文本浮层 MUST 由 `::after` 伪元素的 `content: attr(data-tooltip)` 渲染，三角形指针 MUST 由 `::before` 伪元素的 border 技巧渲染。元素本身 MUST 设置 `position: relative`，伪元素 MUST 设置 `position: absolute` 相对父元素定位，并设置 `pointer-events: none` 避免拦截鼠标事件。`assets/css/tooltip.css` MUST 通过 `nuxt.config.ts` 的 `css` 配置项全局引入，确保所有页面可用。

#### Scenario: 浮层文本由 ::after 伪元素渲染

- **WHEN** 元素具有 `data-tooltip="复制"` 属性且 hover 触发显示
- **THEN** 浮层文本由 `[data-tooltip]::after` 伪元素的 `content: attr(data-tooltip)` 渲染为 "复制"
- **AND** 伪元素 `pointer-events: none`，不拦截父元素或周边的鼠标事件

#### Scenario: 浮层三角形指针由 ::before 伪元素渲染

- **WHEN** tooltip 显示时
- **THEN** 浮层下方出现由 `[data-tooltip]::before` 的 `border: 5px solid transparent` + `border-top-color` 技巧生成的三角形指针
- **AND** 指针颜色与浮层背景色一致（`theme('colors.semi.tooltip.bg')`）

#### Scenario: 全局 CSS 在 Nuxt 配置中引入

- **WHEN** 检查 `nuxt.config.ts` 的 `css` 数组
- **THEN** 数组中包含 `'~/assets/css/tooltip.css'`
- **AND** 该样式在所有页面路由下均生效，无需组件级 import

### Requirement: 桌面端 hover 触发显示与隐藏

Tooltip SHALL 仅在桌面端（视口宽度 ≥ 640px，对应 Tailwind `sm:` 断点）通过 CSS `:hover` 触发显示，鼠标移出隐藏。触发逻辑 MUST 由 CSS 媒体查询 `@media (width >= 640px)` 内的 `[data-tooltip]:hover::after, [data-tooltip]:hover::before` 选择器实现，默认状态 `visibility: hidden; opacity: 0`，hover 状态 `visibility: visible; opacity: 1`。禁止使用 JS 事件监听控制显示隐藏。

#### Scenario: 桌面端鼠标 hover 显示 tooltip

- **WHEN** 视口宽度 ≥ 640px
- **AND** 鼠标悬停在带 `data-tooltip` 属性的元素上
- **THEN** `::after` 与 `::before` 伪元素的 `visibility` 切换为 `visible`、`opacity` 切换为 `1`
- **AND** 浮层平滑淡入显示

#### Scenario: 鼠标移出后隐藏 tooltip

- **WHEN** 鼠标离开带 `data-tooltip` 属性的元素
- **THEN** 伪元素 `visibility` 回到 `hidden`、`opacity` 回到 `0`
- **AND** 浮层平滑淡出消失

### Requirement: 触摸设备不显示 tooltip

由于触摸设备（手机、平板 WebView）上 `:hover` 不可靠（触摸后状态残留、无真正悬停状态），Tooltip SHALL 在视口宽度 < 640px 时完全不显示。隐藏逻辑 MUST 由 CSS 媒体查询范围实现：`:hover` 触发规则仅写在 `@media (width >= 640px)` 块内，<640px 时 `[data-tooltip]:hover::after/before` 选择器不存在，伪元素永远保持 `visibility: hidden; opacity: 0`。

#### Scenario: 手机端触摸不触发 tooltip

- **WHEN** 视口宽度 < 640px（手机竖屏或窄屏）
- **AND** 用户触摸带 `data-tooltip` 属性的元素
- **THEN** `::after` / `::before` 伪元素不切换到可见状态
- **AND** 视觉上不出现任何浮层

#### Scenario: 平板横屏（≥640px）下 hover 可用

- **WHEN** 视口宽度 ≥ 640px（如 Android 平板横屏）
- **AND** 鼠标/触控笔悬停在带 `data-tooltip` 属性的元素上
- **THEN** tooltip 正常显示（与桌面端一致）

### Requirement: 位置支持 top 与 bottom 两个方向（默认 top）

Tooltip SHALL 支持 `top`（默认）与 `bottom` 两个方向，通过 `v-tooltip:bottom="text"` 指令 arg 形式或省略 arg（默认 top）指定。`TooltipPosition` 类型 MUST 限定为 `'top' | 'bottom'` 字面量联合类型。当位置为 `top` 时，`tooltipDirective` MUST NOT 写入 `data-tooltip-position` 属性（CSS 默认样式即 top）；当位置为 `bottom` 时，写入 `data-tooltip-position="bottom"`，CSS 通过 `[data-tooltip-position='bottom']::after/before` 选择器将浮层翻转到元素下方。

#### Scenario: 默认 top 位置不写入 data-tooltip-position 属性

- **WHEN** 使用 `v-tooltip="text"`（不带 arg）
- **THEN** 元素 DOM 上仅有 `data-tooltip` 属性，无 `data-tooltip-position` 属性
- **AND** CSS 默认将浮层渲染在元素上方（`bottom: calc(100% + semi-sm)`）

#### Scenario: bottom 位置写入 data-tooltip-position 并翻转浮层

- **WHEN** 使用 `v-tooltip:bottom="text"`
- **THEN** 元素 DOM 上同时具有 `data-tooltip` 与 `data-tooltip-position="bottom"` 属性
- **AND** CSS 通过 `[data-tooltip-position='bottom']::after` 将 `top: calc(100% + semi-sm); bottom: auto` 翻转浮层到元素下方
- **AND** `::before` 三角形指针同步翻转为 `border-bottom-color`，朝上指向元素

#### Scenario: 类型系统约束位置仅允许 top 或 bottom

- **WHEN** 在 TS 中声明 `TooltipPosition` 类型
- **THEN** 类型定义为 `'top' | 'bottom'` 字面量联合
- **AND** 指令 `binding.arg` 在 `setTooltipAttrs` 中被断言为 `TooltipPosition`，非法值由 CSS 默认回退到 top 表现

### Requirement: 内容动态更新（updated 钩子同步属性）

当 `v-tooltip` 绑定的 `binding.value` 变化时，指令 SHALL 在 `updated` 钩子中同步更新元素的 `data-tooltip` 属性，使浮层文本实时反映最新值。当 `binding.value` 由非空变为空（falsy）时，指令 MUST 调用 `removeTooltipAttrs` 清除 `data-tooltip` 与 `data-tooltip-position` 属性，使元素不再显示 tooltip。`unmounted` 钩子 MUST 同样清除这两个属性以避免 DOM 残留。

#### Scenario: 绑定值变化时浮层文本同步更新

- **WHEN** 组件状态 `tooltipText` 从 `"复制"` 变为 `"已复制"`
- **AND** 模板 `<button v-tooltip="tooltipText">` 因响应式更新触发指令 `updated` 钩子
- **THEN** 元素 DOM 上的 `data-tooltip` 属性从 `"复制"` 更新为 `"已复制"`
- **AND** 下次 hover 时浮层显示 "已复制"

#### Scenario: 绑定值变为空时移除 tooltip

- **WHEN** 组件状态 `tooltipText` 从 `"复制"` 变为 `""`（空字符串）
- **THEN** 指令 `updated` 钩子调用 `removeTooltipAttrs`
- **AND** 元素 DOM 上的 `data-tooltip` 与 `data-tooltip-position` 属性被移除
- **AND** hover 时不再显示浮层

#### Scenario: 组件卸载时清理属性

- **WHEN** 带 `v-tooltip` 的组件被卸载
- **THEN** 指令 `unmounted` 钩子调用 `removeTooltipAttrs`
- **AND** 卸载前的 DOM 节点不再携带 `data-tooltip*` 属性（避免被复用/缓存场景下残留）

### Requirement: Semi Design Token 设计令牌集成

Tooltip 的所有视觉值（颜色、圆角、字号、阴影、z-index、间距、过渡时长）SHALL 统一引用 `tailwind.config.js` 中定义的 Semi Design Token，通过 Tailwind 的 `theme()` 函数在 CSS 中读取，禁止在 `tooltip.css` 中硬编码十六进制色值或像素数值。MUST 引用以下令牌：背景色 `colors.semi.tooltip.bg`、文字色 `colors.semi.tooltip.text`、z-index `zIndex.semi-tooltip`、圆角 `borderRadius.semi-md`、字号 `fontSize.semi-caption.0`、阴影 `boxShadow.semi-tooltip`、内边距 `spacing.semi-xs` / `spacing.semi-sm-md`、偏移 `spacing.semi-sm`、过渡时长 `transitionDuration.semi-fast`。

#### Scenario: 浮层背景与文字色引用 semi.tooltip 令牌

- **WHEN** 检查 `[data-tooltip]::after` 的样式声明
- **THEN** `background` 引用 `theme('colors.semi.tooltip.bg')`
- **AND** `color` 引用 `theme('colors.semi.tooltip.text')`
- **AND** 不存在硬编码的 `#xxx` 颜色字面量

#### Scenario: 浮层 z-index 引用 semi-tooltip 令牌

- **WHEN** 检查 `::after` 与 `::before` 伪元素的 `z-index` 声明
- **THEN** 两者均引用 `theme('zIndex.semi-tooltip')`
- **AND** 该 z-index 高于页面普通内容层，确保浮层覆盖在内容之上

#### Scenario: 圆角、字号、阴影均引用 semi 令牌

- **WHEN** 检查 `::after` 伪元素的几何样式
- **THEN** `border-radius` 引用 `theme('borderRadius.semi-md')`
- **AND** `font-size` 引用 `theme('fontSize.semi-caption.0')`
- **AND** `box-shadow` 引用 `theme('boxShadow.semi-tooltip')`

### Requirement: 过渡动画使用 semi-fast 时长

Tooltip 的显示/隐藏 SHALL 通过 `opacity` + `visibility` 双属性过渡实现平滑淡入淡出，过渡时长 MUST 引用 `transitionDuration.semi-fast`（项目标准为 150ms），缓动函数使用 `ease`。禁止使用 `transform` 弹跳或位移动画（避免与 `translateX(-50%)` 居中变换冲突）。`visibility` 必须与 `opacity` 同步过渡，确保淡出完全后再 `visibility: hidden`，避免鼠标移出后伪元素仍拦截 hit testing。

#### Scenario: 显示时平滑淡入

- **WHEN** 视口 ≥ 640px 且鼠标 hover 到带 `data-tooltip` 的元素
- **THEN** `opacity` 从 `0` 过渡到 `1`，`visibility` 从 `hidden` 过渡到 `visible`
- **AND** 过渡时长为 `theme('transitionDuration.semi-fast')`（150ms），缓动 `ease`

#### Scenario: 隐藏时先完成淡出再隐藏 visibility

- **WHEN** 鼠标移出元素
- **THEN** `opacity` 从 `1` 过渡回 `0`，`visibility` 同步过渡回 `hidden`
- **AND** 过渡期间伪元素不拦截鼠标事件（`pointer-events: none`）

### Requirement: 纯图标按钮强制使用 v-tooltip 提供文字提示

项目硬性约束：所有纯图标按钮（无文字、仅图标的可点击元素）MUST 使用 `v-tooltip` 包裹提供文字提示，禁止使用浏览器原生 `title` 属性。理由：原生 `title` 在 Android WebView 中视觉风格不协调、显示延迟长（默认 1-2 秒）且不可定制，与本项目的 Semi Design Token 主题脱节。`v-tooltip` 通过 CSS 控制即时显示、统一视觉、SSR 安全、触摸设备降级隐藏，是项目唯一的文字提示渠道。

#### Scenario: 纯图标按钮使用 v-tooltip 包裹

- **WHEN** 开发者在组件中新增一个仅含 SVG 图标、无可见文字的按钮
- **THEN** 该按钮 MUST 使用 `v-tooltip="动作描述"` 指令绑定文字提示
- **AND** 禁止使用 `title="动作描述"` 原生属性

#### Scenario: 代码审查发现原生 title 属性应被替换

- **WHEN** 代码审查或 lint 检查发现某纯图标按钮元素上存在 `title` 属性
- **THEN** 该写法判定为违规，MUST 替换为 `v-tooltip` 指令
- **AND** 替换后视觉与延迟问题同步消除

#### Scenario: 含文字的按钮不强制 v-tooltip

- **WHEN** 按钮内已包含可见文字标签（如 `<button>复制</button>`）
- **THEN** 不强制使用 `v-tooltip`（文字本身已提供语义）
- **AND** 该约束仅针对"无可见文字"的纯图标按钮
