# 语音输入 - 技术设计

## 技术选型

### 语音识别 API：Web Speech API

使用浏览器内置的 `SpeechRecognition`（Chrome/Edge）或 `webkitSpeechRecognition`（Safari），**不引入任何第三方库**。

```ts
// 兼容性检测（注意 TypeScript 中需要 as any 绕过类型检查）
const SpeechRecognitionAPI =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
```

- **支持**：Chrome、Edge、Safari 15+（含 iOS）、Android WebView
- **不支持**：Firefox（`SpeechRecognition` 不可用，按钮隐藏）
- **语言**：`zh-CN`（中文识别）
- **模式**：`interimResults: true`（实时识别），`continuous: false`（说完自动停止）

### 为什么不用第三方服务

- 浏览器原生 API 在 Android WebView 和 Chrome 中广泛可用
- 零额外依赖，减小包体积
- 减少网络延迟和 API 成本

## 组件交互

### 按钮位置

发送按钮区域当前有两个互斥按钮：`v-if="!isLoading"`（发送）和 `v-else`（停止）。语音按钮放在 textarea 和发送按钮之间：

```
[图片上传] [textarea区域] [语音按钮] [发送/停止]
```

### 状态机

```
         idle ──点击──→ recording（红色脉冲动画）
                            │
                            ├── 再次点击 → idle（手动停止录音）
                            ├── 识别结束 → idle（自动停止，追加文字）
                            └── 识别错误 → idle + emit('speechError')
```

不支持 SpeechRecognition 的浏览器中 `speechSupported = false`，按钮不渲染。

### Props / Emits 变更

不改动现有 Props 和 Emits 接口。语音按钮通过 `inputValue` computed 直接修改输入文本。仅追加 `isFinal === true` 的识别结果，避免 interim 中间结果重复追加：

```ts
// onresult 中只追加 final 结果，忽略 interim
recognition.onresult = (event: SpeechRecognitionEvent) => {
  let finalTranscript = ''
  for (let i = event.resultIndex; i < event.results.length; i++) {
    if (event.results[i].isFinal) {
      finalTranscript += event.results[i][0].transcript
    }
  }
  if (finalTranscript) {
    inputValue.value = (inputValue.value + ' ' + finalTranscript).trim()
  }
}
```

## 模板变更

在 `ChatInput.vue` 模板中，在 textarea 容器 `<div class="flex-1...">` 和发送按钮之间插入语音按钮：

```html
<!-- 语音输入按钮 -->
<button
  v-if="speechSupported"
  type="button"
  :disabled="isLoading"
  v-tooltip="isLoading ? '' : isRecording ? '点击停止录音' : '语音输入'"
  class="shrink-0 relative min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl transition-all duration-200 active:scale-95"
  :class="isRecording
    ? 'text-red-500 bg-red-50 hover:bg-red-100'
    : isLoading
      ? 'text-gray-300 cursor-not-allowed'
      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'"
  @click="toggleSpeechRecognition"
>
  <!-- 脉冲动画圆环（录音中），依赖按钮 relative 定位 -->
  <span
    v-if="isRecording"
    class="absolute inset-1 rounded-full border-2 border-red-400 animate-ping opacity-30"
  />
  <!-- 麦克风 SVG 图标 -->
  <svg>...</svg>
</button>
```

### isLoading 时语音按钮行为

AI 回复期间（`isLoading = true`）发送按钮被替换为停止按钮，此时语音输入无意义。语音按钮在 `isLoading` 时 `disabled`、灰色不可点击。

### 实例生命周期管理

每次点击创建新的 `SpeechRecognition` 实例，存储在 `recognitionRef` 中。录音结束或组件卸载时必须清理：

```ts
const recognitionRef = ref<SpeechRecognition | null>(null)

onUnmounted(() => {
  recognitionRef.value?.abort()
})
```

## 响应式适配

| 属性         | 手机（默认）                | 平板（sm:）                 |
| ------------ | --------------------------- | --------------------------- |
| 按钮最小尺寸 | `min-w-[44px] min-h-[44px]` | `min-w-[40px] min-h-[40px]` |
| 图标大小     | `w-5 h-5`                   | `w-4 h-4`                   |

## 错误处理

| 场景                           | 处理                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| 浏览器不支持 SpeechRecognition | `speechSupported = false`，按钮隐藏                                   |
| 识别错误（`onerror`）          | 停止录音，通过 `useToast().error()` 提示                              |
| 用户未授权麦克风               | `onerror` 中 `error === 'not-allowed'`，toast 提示"麦克风权限被拒绝"  |
| 快速连续点击                   | `isRecording` 守卫防止重复创建实例                                    |
| `useToast` 不可用              | ChatInput 作为子组件无法直接使用 composable，通过 emit 事件通知父组件 |

### useToast 集成问题

ChatInput 是纯展示组件，当前不引入 useToast。语音识别的错误提示通过新增 emit 事件传递给父组件 `ai-chat.vue` 处理：

```ts
// ChatInput.vue 新增 emit
emit('speechError', message: string)

// ai-chat.vue 处理
@speech-error="(msg) => toast.error(msg)"
```

## SSR 安全

`window.SpeechRecognition` 仅在客户端可用，`speechSupported` 初始值设为 `false`，在 `onMounted` 中检测：

```ts
const speechSupported = ref(false)

onMounted(() => {
  speechSupported.value = !!(window.SpeechRecognition || window.webkitSpeechRecognition)
})
```

这确保 SSR 和客户端初始渲染一致（按钮都不会渲染），客户端水合后再显示按钮。
