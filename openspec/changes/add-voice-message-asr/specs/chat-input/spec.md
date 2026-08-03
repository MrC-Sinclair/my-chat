## ADDED Requirements

### Requirement: 语音入口改造为统一菜单

系统 SHALL 将 ChatInput 中的 Web Speech API 语音输入按钮改造为统一的语音入口按钮（麦克风图标），点击后展开菜单，用户可选择「语音消息」或「语音输入」。两种能力独立并存但共享入口：「语音消息」使用 `MediaRecorder` 录制完整语音并发送为语音气泡；「语音输入」使用浏览器 `SpeechRecognition` 实时转写填入输入框。入口按钮手机端触摸目标 MUST ≥ 44px（`min-w-[44px] min-h-[44px]`），平板端（`sm:`）可缩至 40px。按钮为纯图标按钮，MUST 使用 `v-tooltip` 提供文字提示。

#### Scenario: 浏览器同时支持 MediaRecorder 与 SpeechRecognition

- **WHEN** 浏览器同时支持 `MediaRecorder` 与 `SpeechRecognition`
- **THEN** 语音入口按钮显示在输入框右侧（发送按钮附近），点击后菜单包含「语音消息」与「语音输入」两个选项
- **AND** 选择「语音消息」后启动 `MediaRecorder` 录音流程
- **AND** 选择「语音输入」后启动 `SpeechRecognition` 实时转写流程

#### Scenario: 仅支持 MediaRecorder

- **WHEN** 浏览器不支持 `SpeechRecognition` 但支持 `MediaRecorder`
- **THEN** 语音入口按钮直接触发「语音消息」录音，不展开菜单（或菜单仅含「语音消息」一项）
- **AND** 通过 `useToast` 提示「当前环境不支持语音输入」仅在用户主动查看入口菜单时说明

#### Scenario: 仅支持 SpeechRecognition

- **WHEN** 浏览器支持 `SpeechRecognition` 但不支持 `MediaRecorder`
- **THEN** 语音入口按钮直接触发「语音输入」，不展开菜单（或菜单仅含「语音输入」一项）
- **AND** 保持与现有 Web Speech API 按钮一致的行为

#### Scenario: 两种能力均不支持

- **WHEN** 浏览器同时不支持 `MediaRecorder` 与 `SpeechRecognition`
- **THEN** 语音入口按钮**仍然渲染**（与决策 7「始终渲染 + 运行时检测降级」保持一致）
- **AND** 用户点击按钮时，在事件处理函数内检测 API 不可用，通过 `useToast` 提示「当前环境不支持语音功能」
- **AND** 不进入录音或语音输入状态

#### Scenario: 语音入口按钮触摸目标尺寸

- **WHEN** 在手机端（< 640px）渲染语音入口按钮
- **THEN** 按钮尺寸 `min-w-[44px] min-h-[44px]`
- **AND** 点击区域满足触摸目标 ≥ 44px 规范

#### Scenario: 语音入口按钮在平板端的尺寸

- **WHEN** 在平板端（≥ 640px，`sm:` 断点）渲染语音入口按钮
- **THEN** 按钮尺寸缩小为 `sm:min-w-[40px] sm:min-h-[40px]`
- **AND** 保持视觉一致性

### Requirement: 语音消息录音状态视觉反馈

系统 SHALL 在录音过程中提供明确的视觉反馈：入口按钮或相关录制控件变为红色脉冲动画状态，显示录音时长计时（如 `00:05`）。录音中再次点击按钮停止录制。所有状态切换 MUST 使用 `transition` 平滑过渡，禁止瞬间跳变。

#### Scenario: 录音中按钮显示脉冲动画与时长

- **WHEN** 用户选择「语音消息」并开始录制
- **THEN** 按钮变为红色背景 + `animate-ping` 脉冲动画
- **AND** 按钮旁显示录音时长计时（`mm:ss` 格式）
- **AND** 使用 `transition` 平滑过渡到录音状态

#### Scenario: 停止录制后按钮恢复待机

- **WHEN** 用户在录音中再次点击按钮停止录制
- **THEN** 按钮恢复待机状态（默认配色）
- **AND** 停止脉冲动画与时长计时
- **AND** 使用 `transition` 平滑过渡

#### Scenario: 录音上传中显示 loading 状态

- **WHEN** 录音结束并自动上传到 `/api/audio/transcribe`
- **THEN** 按钮显示 loading 指示器（spinner）
- **AND** 禁用按钮防止重复操作
- **AND** 转写完成后恢复待机状态

#### Scenario: 录音超过最大时长自动停止

- **WHEN** 用户录音时长达到 60 秒（`MAX_RECORDING_DURATION`）
- **THEN** 系统自动调用 `mediaRecorder.stop()` 停止录制
- **AND** 通过 `useToast` 显示提示「录音已超过 60 秒，已自动停止」
- **AND** 按钮恢复待机状态，自动开始上传转写

#### Scenario: 录音启动期间防止并发点击

- **WHEN** 用户点击语音入口按钮，`getUserMedia` 正在等待用户授权
- **AND** 用户再次点击按钮
- **THEN** 第二次点击被 `isStartingRecording` 标志位守卫阻止
- **AND** 不创建第二个 `MediaRecorder` 实例
- **AND** 用户授权完成后（成功或失败），`isStartingRecording` 重置为 `false`

### Requirement: 语音入口布局与图标区分

语音入口按钮 SHALL 位于 ChatInput 输入框**右侧**（发送按钮附近），避免与左侧已有的图片上传、文生图按钮挤占输入框宽度。入口使用「麦克风」图标；展开菜单中的「语音消息」选项使用「声波+对话气泡」图标，「语音输入」选项使用「麦克风+输入光标」图标。`v-tooltip` 文案 MUST 区分：入口提示「语音功能」，菜单项分别提示「语音消息」与「语音输入」。

#### Scenario: 入口按钮位于输入框右侧

- **WHEN** ChatInput 渲染
- **THEN** 语音入口按钮显示在输入框右侧（发送按钮附近）
- **AND** 左侧仍只显示图片上传、文生图两个按钮
- **AND** 320px 屏幕下输入框仍保留可用宽度

#### Scenario: 菜单项图标区分

- **WHEN** 用户点击语音入口按钮展开菜单
- **THEN** 「语音消息」选项显示「声波+对话气泡」图标
- **AND** 「语音输入」选项显示「麦克风+输入光标」图标
- **AND** 两者 tooltip 文案不同，避免混淆
