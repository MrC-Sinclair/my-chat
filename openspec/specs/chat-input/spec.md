# ChatInput 语音输入

## ADDED Requirements

### Requirement: 语音识别按钮

系统 SHALL 在 ChatInput 组件的发送按钮左侧显示一个麦克风图标按钮，用于启动语音识别输入。

- 按钮仅在不支持 `SpeechRecognition` API 的浏览器中隐藏
- 按钮手机端触摸目标 SHALL ≥ 44px
- 按钮为纯图标按钮，SHALL 使用 `v-tooltip` 提供文字提示

#### Scenario: 用户点击语音按钮启动录音

- Given 浏览器支持 SpeechRecognition API
- And 用户未处于 AI 回复等待状态
- When 用户点击麦克风按钮
- Then 按钮变为红色脉冲动画状态
- And 系统启动语音识别

#### Scenario: 浏览器不支持语音识别

- Given 浏览器不支持 SpeechRecognition API
- Then 语音按钮不渲染

### Requirement: 语音识别文字追加

系统 SHALL 将语音识别的最终结果（`isFinal === true`）追加到输入框末尾，忽略中间结果。

#### Scenario: 语音识别完成后追加文字

- Given 用户正在录音
- When 语音识别产生 final 结果
- Then 识别文字追加到输入框末尾
- And interim 中间结果不追加

#### Scenario: 用户手动停止录音

- Given 用户正在录音
- When 用户再次点击麦克风按钮
- Then 系统停止语音识别
- And 按钮恢复待机状态

#### Scenario: 语音识别自动结束

- Given 用户正在录音
- When 语音识别自动结束（用户停止说话）
- Then 按钮恢复待机状态
- And 已识别的 final 结果保留在输入框中

### Requirement: 语音识别错误处理

系统 SHALL 在语音识别出错时通过 toast 向用户展示错误信息。

#### Scenario: 麦克风权限被拒绝

- Given 用户点击麦克风按钮
- And 浏览器弹出麦克风权限请求
- When 用户拒绝权限
- Then 系统显示 toast 错误提示"麦克风权限被拒绝"
- And 按钮恢复待机状态

#### Scenario: 语音识别发生其他错误

- Given 用户正在录音
- When 语音识别发生错误（网络中断等）
- Then 系统显示 toast 错误提示
- And 按钮恢复待机状态

### Requirement: AI 回复期间禁用语音按钮

系统 SHALL 在 AI 回复期间（`isLoading = true`）禁用语音按钮。

#### Scenario: AI 回复中点击语音按钮

- Given AI 正在回复（isLoading = true）
- Then 语音按钮显示为灰色禁用状态
- And 点击无响应
