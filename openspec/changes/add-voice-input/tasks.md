# 语音输入 - 实现任务清单

## 1. ChatInput.vue 添加语音识别逻辑

- [ ] **1.1** 导入 `onMounted`、`onUnmounted` 生命周期钩子（当前组件未使用）
- [ ] **1.2** 添加 `speechSupported`、`isRecording`、`recognitionRef` 响应式状态
- [ ] **1.3** 在 `onMounted` 中检测 `window.SpeechRecognition` / `window.webkitSpeechRecognition` 可用性，设置 `speechSupported`
- [ ] **1.4** 实现 `toggleSpeechRecognition()` 函数：
  - 创建 `SpeechRecognition` 实例存入 `recognitionRef`，设置 `lang: 'zh-CN'`、`interimResults: true`、`continuous: false`
  - 监听 `onresult`：遍历 `event.results`，**仅追加 `isFinal === true` 的结果**到 `inputValue` 末尾，忽略 interim 中间结果
  - 监听 `onerror`：停止录音（`recognitionRef.value?.stop()`），emit `speechError` 事件，根据 `error` 类型给出友好提示（`not-allowed` → "麦克风权限被拒绝"）
  - 监听 `onend`：设置 `isRecording = false`、`recognitionRef.value = null`
  - 点击按钮时：如果 `isRecording` 则调用 `.stop()`，否则调用 `.start()` 并设 `isRecording = true`
- [ ] **1.5** 在 `onUnmounted` 中调用 `recognitionRef.value?.abort()` 清理实例
- [ ] **1.6** 新增 `speechError` emit 声明

## 2. ChatInput.vue 添加语音按钮模板

- [ ] **2.1** 在 textarea 区域和发送/停止按钮之间插入语音按钮，发送和停止两个分支前都要放（`v-if="speechSupported"`）
- [ ] **2.2** 按钮使用麦克风 SVG 图标，录音中显示红色 + `animate-ping` 脉冲圆环
- [ ] **2.3** 按钮使用 `v-tooltip` 提示"语音输入" / "点击停止录音"（`isLoading` 时不显示提示）
- [ ] **2.4** 响应式尺寸：手机 `min-w-[44px] min-h-[44px]`，平板 `sm:min-w-[40px] sm:min-h-[40px]`
- [ ] **2.5** 按钮添加 `active:scale-95` 点击反馈
- [ ] **2.6** 按钮加 `relative` 定位，确保脉冲圆环 `absolute` 相对按钮定位
- [ ] **2.7** `isLoading` 时按钮 `disabled` + 灰色不可点击样式

## 3. ai-chat.vue 集成语音错误提示

- [ ] **3.1** 在 `<ChatInput>` 组件上监听 `@speech-error` 事件
- [ ] **3.2** 事件处理中调用 `toast.error(msg)` 显示错误提示

## 4. 验证

- [ ] **4.1** 运行 `pnpm typecheck`，确保无类型错误
- [ ] **4.2** 运行 `pnpm lint`，确保无 lint 错误
- [ ] **4.3** 在 Chrome 中手动测试：点击麦克风 → 说话 → 文字追加入输入框 → 自动停止
- [ ] **4.4** 在 Firefox 中验证语音按钮不渲染
- [ ] **4.5** 验证录音中按钮红色脉冲动画、再次点击停止录音
- [ ] **4.6** 验证 `isLoading` 时按钮禁用且不可点击
