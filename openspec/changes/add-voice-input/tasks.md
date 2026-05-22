# 语音输入 - 实现任务清单

## 1. ChatInput.vue 添加语音识别逻辑

- [ ] **1.1** 添加 `speechSupported`、`isRecording` 响应式状态
- [ ] **1.2** 在 `onMounted` 中检测 `window.SpeechRecognition` / `window.webkitSpeechRecognition` 可用性，设置 `speechSupported`
- [ ] **1.3** 实现 `toggleSpeechRecognition()` 函数：
  - 创建 `SpeechRecognition` 实例，设置 `lang: 'zh-CN'`、`interimResults: true`
  - 监听 `onresult`：将 `event.results` 中的文字追加到 `inputValue` 末尾
  - 监听 `onerror`：停止录音，emit `speechError` 事件
  - 监听 `onend`：设置 `isRecording = false`
  - 点击按钮时：如果正在录音则调用 `.stop()`，否则调用 `.start()`
- [ ] **1.4** 新增 `speechError` emit 声明

## 2. ChatInput.vue 添加语音按钮模板

- [ ] **2.1** 在 textarea 区域和发送按钮之间插入语音按钮（`v-if="speechSupported"`）
- [ ] **2.2** 按钮使用麦克风 SVG 图标，录音中显示红色 + `animate-ping` 脉冲圆环
- [ ] **2.3** 按钮使用 `v-tooltip` 提示"语音输入"/"点击停止录音"
- [ ] **2.4** 响应式尺寸：手机 `min-w-[44px] min-h-[44px]`，平板 `sm:min-w-[40px] sm:min-h-[40px]`
- [ ] **2.5** 按钮添加 `active:scale-95` 点击反馈

## 3. ai-chat.vue 集成语音错误提示

- [ ] **3.1** 在 `<ChatInput>` 组件上监听 `@speech-error` 事件
- [ ] **3.2** 事件处理中调用 `toast.error(msg)` 显示错误提示

## 4. 验证

- [ ] **4.1** 运行 `pnpm typecheck`，确保无类型错误
- [ ] **4.2** 运行 `pnpm lint`，确保无 lint 错误
- [ ] **4.3** 在浏览器中手动测试：点击麦克风按钮 → 说话 → 文字出现 → 自动停止
- [ ] **4.4** 测试不支持浏览器（Firefox）中按钮隐藏
- [ ] **4.5** 测试录音中按钮的脉冲动画和红色状态