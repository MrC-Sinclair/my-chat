# ChatInput 语音输入

## Purpose

为移动端用户提供语音输入能力，通过浏览器原生 SpeechRecognition API 将语音转为文字，追加到聊天输入框。

## Requirements

### Requirement: 语音识别按钮

系统 SHALL 在 ChatInput 组件的发送按钮左侧显示一个麦克风图标按钮，用于启动语音识别输入。

- 按钮仅在不支持 `SpeechRecognition` API 的浏览器中隐藏
- 按钮手机端触摸目标 SHALL ≥ 44px
- 按钮为纯图标按钮，SHALL 使用 `v-tooltip` 提供文字提示

#### Scenario: 用户点击语音按钮启动录音

- **WHEN** 浏览器支持 SpeechRecognition API 且用户未处于 AI 回复等待状态
- **AND** 用户点击麦克风按钮
- **THEN** 按钮变为红色脉冲动画状态
- **AND** 系统启动语音识别

#### Scenario: 浏览器不支持语音识别

- **WHEN** 浏览器不支持 SpeechRecognition API
- **THEN** 语音按钮不渲染

### Requirement: 语音识别文字追加

系统 SHALL 将语音识别的最终结果追加到输入框末尾，忽略中间结果。

#### Scenario: 语音识别完成后追加文字

- **WHEN** 用户正在录音且语音识别产生 final 结果
- **THEN** 识别文字追加到输入框末尾
- **AND** interim 中间结果不追加

#### Scenario: 用户手动停止录音

- **WHEN** 用户正在录音且再次点击麦克风按钮
- **THEN** 系统停止语音识别
- **AND** 按钮恢复待机状态

#### Scenario: 语音识别自动结束

- **WHEN** 用户正在录音且语音识别自动结束（用户停止说话）
- **THEN** 按钮恢复待机状态
- **AND** 已识别的 final 结果保留在输入框中

### Requirement: 语音识别错误处理

系统 SHALL 在语音识别出错时通过 toast 向用户展示错误信息。

#### Scenario: 麦克风权限被拒绝

- **WHEN** 用户点击麦克风按钮后拒绝麦克风权限
- **THEN** 系统显示 toast 错误提示"麦克风权限被拒绝"
- **AND** 按钮恢复待机状态

#### Scenario: 语音识别发生其他错误

- **WHEN** 语音识别发生错误（网络中断等）
- **THEN** 系统显示 toast 错误提示
- **AND** 按钮恢复待机状态

### Requirement: AI 回复期间禁用语音按钮

系统 SHALL 在 AI 回复期间禁用语音按钮。

#### Scenario: AI 回复中点击语音按钮

- **WHEN** AI 正在回复
- **THEN** 语音按钮显示为灰色禁用状态
- **AND** 点击无响应
