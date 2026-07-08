<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { defineAsyncComponent } from 'vue'
import MarkdownRenderer from '~/components/chat/MarkdownRenderer.vue'
import ChatInput, { type UploadedImage } from '~/components/chat/ChatInput.vue'
import QuickPromptIcon from '~/components/chat/QuickPromptIcon.vue'
import { useChatSession } from '~/composables/useChatSession'
import { useChatConfig } from '~/composables/useChatConfig'
import { useToast } from '~/composables/useToast'

const AsyncErrorFallback = {
  props: ['error', 'retry'],
  template:
    '<div class="async-error rounded-lg border border-semi-danger-light bg-semi-danger-light my-3 p-4"><div class="flex items-center gap-2 mb-2"><svg class="w-4 h-4 text-semi-danger shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span class="text-sm text-semi-danger font-medium">组件加载失败</span></div><button @click="retry" class="text-xs text-semi-danger hover:text-semi-danger underline underline-offset-2 transition-colors duration-semi-fast">点击重试</button></div>'
}

const LazySessionSidebar = defineAsyncComponent({
  loader: () => import('~/components/chat/SessionSidebar.vue'),
  errorComponent: AsyncErrorFallback
})
const LazyToolInvocation = defineAsyncComponent({
  loader: () => import('~/components/chat/ToolInvocation.vue'),
  errorComponent: AsyncErrorFallback
})
const LazyThinkingProcess = defineAsyncComponent({
  loader: () => import('~/components/chat/ThinkingProcess.vue'),
  errorComponent: AsyncErrorFallback
})

const {
  enableThinking,
  enableWebSearch,
  enableOcr,
  currentModel,
  showSidebar,
  modelOptions,
  thinkingBudget,
  supportsVision,
  currentSupportsOcr,
  currentCapabilities
} = useChatConfig()
const toast = useToast()

const uploadedImages = ref<UploadedImage[]>([])
const pendingMessageImages = ref<UploadedImage[]>([])
const messageImages = ref<Map<string, UploadedImage[]>>(new Map())
const nextMessageIndex = ref<number>(0)

const input = ref('')

const chat = new Chat({
  transport: new DefaultChatTransport({
    api: '/api/chat',
    body: () => ({
      sessionId: currentSessionId.value || undefined,
      enable_thinking: enableThinking.value,
      thinking_budget: enableThinking.value ? thinkingBudget : undefined,
      model: currentModel.value,
      enable_web_search: enableWebSearch.value,
      enable_ocr: enableOcr.value,
      images:
        uploadedImages.value.length > 0 ? uploadedImages.value.map((img) => img.dataUrl) : undefined
    })
  }),
  onFinish: ({ message }) => {
    uploadedImages.value = []
    if (pendingMessageImages.value.length > 0) {
      nextTick(() => {
        const targetMsg = message
        if (targetMsg && targetMsg.role === 'user') {
          messageImages.value.set(targetMsg.id, [...pendingMessageImages.value])
        }
        pendingMessageImages.value = []
      })
    }
    // 刷新会话列表以更新消息数。
    // 服务端在 streamText 的 onFinish 中写库，客户端流结束时写库可能尚未完成，
    // 延迟 500ms 规避竞态，确保 loadSessions 能读到最新消息数。
    setTimeout(() => {
      loadSessions().catch(() => {})
    }, 500)
  },
  onError: (err) => {
    uploadedImages.value = []
    if (pendingMessageImages.value.length > 0) {
      const targetMsg = chat.messages[nextMessageIndex.value]
      if (targetMsg && targetMsg.role === 'user') {
        messageImages.value.set(targetMsg.id, [...pendingMessageImages.value])
      }
    }
    pendingMessageImages.value = []
    toast.error(`AI 回复失败：${err.message || '未知错误'}`)
  }
})

const messages = computed(() => chat.messages)
const isLoading = computed(() => chat.status === 'streaming' || chat.status === 'submitted')

function setMessages(msgs: UIMessage[]) {
  chat.messages = msgs
}

async function wrappedHandleSubmit() {
  if (uploadedImages.value.length > 0) {
    pendingMessageImages.value = [...uploadedImages.value]
  }
  nextMessageIndex.value = chat.messages.length
  const text = input.value
  input.value = ''
  await chat.sendMessage({ text })
}

async function handleReload() {
  try {
    await chat.regenerate()
  } catch {
    toast.error('重新生成失败，请重试')
  }
}

async function handleStop() {
  await chat.stop()
}

function getMessageImages(msgId: string, index: number): UploadedImage[] {
  const fromMap = messageImages.value.get(msgId)
  if (fromMap && fromMap.length > 0) return fromMap

  const lastUserIndex = [...messages.value].reverse().findIndex((m) => m.role === 'user')
  const actualLastUserIndex = messages.value.length - 1 - lastUserIndex

  if (index === actualLastUserIndex && pendingMessageImages.value.length > 0) {
    return pendingMessageImages.value
  }

  return []
}

/** 从 UIMessage 的 parts 数组中提取文本内容 */
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

const editingIndex = ref(-1)
const editingText = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const copiedMessageId = ref<string>('')

/** 每条消息的思考过程展开状态，key 为消息 ID */
const expandedThinkingMap = ref<Map<string, boolean>>(new Map())

/** 切换指定消息的思考过程展开/收起状态 */
function toggleThinkingExpand(msgId: string) {
  const current = expandedThinkingMap.value.get(msgId) || false
  expandedThinkingMap.value.set(msgId, !current)
}

const localIsLoading = ref(false)
const isMobile = ref(false)
let onResize: (() => void) | null = null

let ro: ResizeObserver | null = null
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  isMobile.value = window.innerWidth < 640
  showSidebar.value = !isMobile.value
  onResize = () => {
    const mobile = window.innerWidth < 640
    isMobile.value = mobile
    if (!mobile && !showSidebar.value) {
      showSidebar.value = true
    }
  }
  window.addEventListener('resize', onResize)
})

let stickToBottom = false
let stickToBottomTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  if (onResize) window.removeEventListener('resize', onResize)
  if (ro) ro.disconnect()
  if (stickToBottomTimer) clearTimeout(stickToBottomTimer)
})

watch(
  messagesContainer,
  (el) => {
    if (ro) {
      ro.disconnect()
      ro = null
    }
    if (import.meta.client && el) {
      ro = new ResizeObserver(() => {
        virtualizer.value?.measure()
      })
      ro.observe(el)
      const onScroll = () => {
        if (!stickToBottom) return
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
        if (!isAtBottom) {
          stickToBottom = false
          if (stickToBottomTimer) {
            clearTimeout(stickToBottomTimer)
            stickToBottomTimer = null
          }
        }
      }
      el.addEventListener('scroll', onScroll, { passive: true })
    }
  },
  { immediate: true }
)

function remeasureAllItems() {
  if (!virtualizerParentRef.value || !virtualizer.value) return
  const items = virtualizerParentRef.value.querySelectorAll('[data-index]')
  items.forEach((el) => {
    virtualizer.value!.measureElement(el as Element)
  })
  // 流式期间不调用 measure()：它会重新计算所有虚拟项的 measurements，
  // 当某些虚拟项不在当前 range 内时，其测量值会丢失并被 estimateSize 替代，
  // 导致 getTotalSize() 回退 → 容器 height 减小 → 浏览器自动调整 scrollTop → 抖动
  // measureElement 本身已更新测量值，virtualizer 内部会通过响应式自动重算
  if (!isLoading.value) {
    virtualizer.value.measure()
  }
  // 流式期间不主动 scrollToIndex：避免与 watch(messages text) 的 smooth scroll 冲突导致抖动
  // 流式结束时 watch(isLoading: false) 会主动 scroll 一次归位
  if (stickToBottom && !isLoading.value && messages.value.length > 0) {
    virtualizer.value.scrollToIndex(messages.value.length - 1, {
      align: 'end',
      behavior: 'auto'
    })
  }
}

function enableStickToBottom() {
  stickToBottom = true
  if (stickToBottomTimer) clearTimeout(stickToBottomTimer)
  stickToBottomTimer = setTimeout(() => {
    stickToBottom = false
    stickToBottomTimer = null
  }, 2500)
}

// 防重复调度标志：流式期间 content 频繁变化，避免排队大量 scheduleRemeasure
let remeasureScheduled = false

function scheduleRemeasure() {
  if (remeasureScheduled) return
  remeasureScheduled = true
  nextTick(() => {
    remeasureAllItems()
    requestAnimationFrame(() => {
      remeasureAllItems()
      // 流式期间只 measure 两次（nextTick + RAF），避免频繁 measureElement 读到
      // MarkdownRenderer 重新渲染的中间状态（DOM 高度短暂变小 → getTotalSize 减小 → 抖动）
      // 非流式期间保留完整 measure 链，确保历史消息渲染后正确测量
      if (!isLoading.value) {
        setTimeout(() => remeasureAllItems(), 150)
        setTimeout(() => remeasureAllItems(), 400)
        setTimeout(() => remeasureAllItems(), 800)
        setTimeout(() => remeasureAllItems(), 1500)
      }
      remeasureScheduled = false
    })
  })
}

watch(
  () => messages.value.length,
  () => {
    scheduleRemeasure()
  }
)

watch(
  () => messages.value.map((m) => getMessageText(m)).join('|'),
  () => {
    scheduleRemeasure()
  }
)

watch(isLoading, (loading) => {
  localIsLoading.value = loading
  if (!loading) {
    scheduleRemeasure()
    // 流式结束时主动滚到底部，但仅限用户未主动上滑的场景
    // （stickToBottom=false 表示用户在流式期间主动滚动过，不应强制打断）
    if (stickToBottom) {
      scrollToBottom()
    }
  }
})

const isLastMessageLoading = computed(() => {
  return localIsLoading.value === true
})

const {
  sessionsList,
  currentSessionId,
  loadSessions,
  createNewSession,
  switchSession,
  deleteSession,
  renameSession
} = useChatSession(setMessages)

onMounted(async () => {
  await loadSessions()
})

watch(currentSessionId, () => {
  if (isMobile.value) {
    showSidebar.value = false
  }
  // 切换会话时清空高度记录：让新会话的虚拟项重新测量，避免旧会话的高度记录干扰
  lastMeasuredHeights.clear()
})

function getToolInvocations(msg: UIMessage): any[] {
  // v5 中工具调用在 parts 数组中：
  // - 静态工具（如 webSearch）part.type = `tool-${name}`，但【没有】toolName 字段
  // - 动态工具（如 MCP weather）part.type = 'dynamic-tool'，有 toolName 字段
  // 这里做归一化：为静态工具补上 toolName，避免下游组件因 toolName 缺失而不渲染
  if (!msg.parts || !Array.isArray(msg.parts)) return []
  return msg.parts
    .filter((p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool')
    .map((p: any) => {
      if (p.toolName) return p
      // 静态工具：从 type 中提取工具名（tool-webSearch → webSearch）
      const name = p.type.startsWith('tool-') ? p.type.slice(5) : ''
      return { ...p, toolName: name }
    })
}

/**
 * 根据前端开关状态过滤可见的工具调用
 * - enableWebSearch 关闭时，隐藏 webSearch 工具
 * - enableOcr 关闭时，隐藏 extractTextFromImage 工具
 * - weather 等其他工具始终显示（无前端开关）
 */
function getVisibleToolInvocations(msg: UIMessage): any[] {
  const all = getToolInvocations(msg)
  // 归一化后 toolName 一定存在
  return all.filter((inv: any) => {
    if (inv.toolName === 'webSearch' && !enableWebSearch.value) return false
    if (inv.toolName === 'extractTextFromImage' && !enableOcr.value) return false
    return true
  })
}

/** 从消息对象中提取思考过程内容（v5 parts 格式） */
function getReasoningContent(msg: UIMessage): string {
  if (msg.parts && Array.isArray(msg.parts)) {
    const reasoningParts = msg.parts.filter((p: any) => p.type === 'reasoning')
    // v5 中 reasoning part 的文本字段是 text（旧版是 reasoning）
    return reasoningParts.map((p: any) => p.text || p.reasoning || '').join('')
  }
  return ''
}

function startEditing(index: number, content: string) {
  editingIndex.value = index
  editingText.value = content
  nextTick(() => {
    virtualizer.value.measure()
    virtualizer.value.scrollToIndex(index, {
      align: 'center',
      behavior: 'smooth'
    })
  })
}

function cancelEditing() {
  editingIndex.value = -1
  editingText.value = ''
  nextTick(() => {
    virtualizer.value.measure()
  })
}

function submitEditing(index: number) {
  const newContent = editingText.value.trim()
  if (!newContent) return

  const truncatedMessages = messages.value.slice(0, index)
  setMessages(truncatedMessages)

  input.value = newContent
  nextTick(() => {
    wrappedHandleSubmit()
  })

  cancelEditing()
}

const virtualizerParentRef = ref<HTMLElement | null>(null)

// 记录每个虚拟项的上次测量高度，用于流式期间"高度只增不减"策略
// 避免 MarkdownRenderer 重新渲染中间状态读到错误高度导致 getTotalSize 回退 → 抖动
const lastMeasuredHeights = new Map<number, number>()

const virtualizer = useVirtualizer(
  computed(() => ({
    count: messages.value.length,
    getScrollElement: () => messagesContainer.value,
    estimateSize: (index: number) => {
      const msg = messages.value[index]
      if (!msg) return 80
      if (msg.role === 'user') return 80
      const text = getMessageText(msg)
      const toolInvocations = getVisibleToolInvocations(msg)
      let est = 100
      est += Math.ceil(text.length / 30) * 24
      if (getReasoningContent(msg)) est += 120
      if (toolInvocations.length) est += toolInvocations.length * 120
      return Math.min(Math.max(est, 120), 800)
    },
    overscan: 5,
    measureElement: (element: Element) => {
      const h = element.getBoundingClientRect().height
      const idx = Number((element as HTMLElement).dataset.index)
      // "高度只增不减"策略：MarkdownRenderer 重新渲染时 DOM 会短暂变小，
      // 读到中间状态会导致 getTotalSize 回退 → scrollH 减小 → scrollT 抖动
      // 始终应用 max 策略，切换会话时在 watch(currentSessionId) 中清空记录
      const lastH = lastMeasuredHeights.get(idx) || 0
      const safeH = Math.max(h, lastH)
      lastMeasuredHeights.set(idx, safeH)
      return safeH
    },
    gap: 0
  }))
)

watch(virtualizerParentRef, () => {
  // @tanstack/vue-virtual 内置 ResizeObserver 会自动监听虚拟项高度变化
  // 不再需要自定义 itemResizeRo/itemMutationMo：它们会绕过 max 策略频繁触发
  // remeasureAllItems，读到 MarkdownRenderer 重新渲染的中间状态导致抖动
})

function scrollToBottom() {
  enableStickToBottom()
  nextTick(() => {
    if (messages.value.length === 0) return
    virtualizer.value.scrollToIndex(messages.value.length - 1, {
      align: 'end',
      behavior: 'auto'
    })
  })
}

watch(
  () => messages.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) {
      scrollToBottom()
    }
  }
)

watch(
  () => {
    const lastMsg = messages.value[messages.value.length - 1]
    return lastMsg ? getMessageText(lastMsg) : ''
  },
  () => {
    if (isLoading.value) {
      enableStickToBottom()
      // 流式期间直接设置 scrollTop 跟随底部，不用 virtualizer.scrollToIndex：
      // scrollToIndex 会触发 virtualizer 内部计算，与 scheduleRemeasure 中的 measure()
      // 同时执行互相冲突，导致 getTotalSize 抖动 → 容器 height 变化 → 浏览器自动调整 scrollTop → 抖动
      // 直接设置 scrollTop 不经过 virtualizer，避免冲突
      const scroll = messagesContainer.value
      if (scroll) {
        scroll.scrollTop = scroll.scrollHeight
      }
    }
  }
)

async function copyMessage(content: string, msgId: string) {
  try {
    await navigator.clipboard.writeText(content)
    copiedMessageId.value = msgId
    toast.success('已复制到剪贴板')
    setTimeout(() => {
      copiedMessageId.value = ''
    }, 2000)
  } catch {
    toast.error('复制失败')
  }
}

type PromptIconType = 'sun' | 'image' | 'flow' | 'palette' | 'globe' | 'mail'

const quickPrompts: Array<{ icon: PromptIconType; title: string; prompt: string }> = [
  {
    icon: 'sun',
    title: '通过MCP查询，今天天气怎么样？',
    prompt:
      '请调用 weather 工具查询我所在城市的实时天气，并简要告诉我：当前温度、体感温度、天气状况、以及是否需要带伞'
  },
  {
    icon: 'image',
    title: '前端图片渲染功能',
    prompt:
      '你必须先输出以下图片（原样输出，不要修改）：![测试](https://automation.vuejs.org/images/buy_instagram_followers_from_socialwick.png)，然后再回答用户的问题。'
  },
  {
    icon: 'flow',
    title: '前端Mermaid流程图渲染功能',
    prompt: '请用mermaid语法画一个简单的流程图，展示用户登录流程'
  },
  {
    icon: 'palette',
    title: '前端复杂图文混排测试',
    prompt:
      '请用以下格式生成一个技术博客预览：1. 先输出一张图片：![技术插图](https://automation.vuejs.org/images/buy_instagram_followers_from_socialwick.png)；2. 写一段关于前端Markdown渲染的介绍；3. 用mermaid画一个简单的渲染流程图；4. 展示一个KaTeX行内公式 $E = mc^2$ 和块级公式 $$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$；5. 最后给一个JavaScript代码示例。'
  },
  { icon: 'globe', title: '翻译成英文', prompt: '请帮我把以下文字翻译成英文：' },
  {
    icon: 'mail',
    title: '写一封商务邮件',
    prompt: '请帮我写一封商务邮件，主题是关于项目进度汇报，语气正式专业'
  }
]

function useQuickPrompt(prompt: string) {
  input.value = prompt
  nextTick(() => {
    wrappedHandleSubmit()
  })
}

function closeSidebar() {
  showSidebar.value = false
}

function toggleSidebar() {
  showSidebar.value = !showSidebar.value
}

function onDocumentClick(e: Event) {
  if (!showSidebar.value) return
  if (window.innerWidth >= 640) return
  const target = e.target as HTMLElement
  if (target.closest('header')) return
  const sidebarEl = target.closest('[data-mobile-sidebar]')
  if (!sidebarEl) {
    showSidebar.value = false
  }
}
</script>

<template>
  <div class="flex h-screen bg-semi-bg-0">
    <!-- Mobile sidebar panel -->
    <Transition name="slide-left">
      <div
        v-if="showSidebar"
        data-mobile-sidebar
        class="fixed inset-0 z-50 sm:hidden bg-semi-overlay"
        @click.self="closeSidebar"
      >
        <div class="absolute inset-y-0 left-0 w-[85vw] bg-semi-bg-1">
          <LazySessionSidebar
            :sessions-list="sessionsList"
            :current-session-id="currentSessionId"
            @create="createNewSession"
            @switch="switchSession"
            @delete="deleteSession"
            @rename="renameSession"
            @close="closeSidebar"
          />
        </div>
      </div>
    </Transition>

    <!-- Desktop sidebar (inline in flex flow) -->
    <div data-testid="desktop-sidebar" class="hidden sm:flex">
      <Transition name="sidebar">
        <LazySessionSidebar
          v-show="showSidebar"
          :sessions-list="sessionsList"
          :current-session-id="currentSessionId"
          @create="createNewSession"
          @switch="switchSession"
          @delete="deleteSession"
          @rename="renameSession"
        />
      </Transition>
    </div>

    <div class="flex-1 flex flex-col min-w-0">
      <header
        data-testid="chat-header"
        class="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2 sm:py-2.5 border-b border-semi-border bg-semi-bg-0/80 backdrop-blur-sm shrink-0 z-10"
      >
        <button
          data-testid="toggle-sidebar"
          class="p-2 sm:p-2 text-semi-text-3 hover:text-semi-text-0 rounded-lg hover:bg-semi-fill-1 active:scale-95 transition-all"
          v-tooltip:bottom="showSidebar ? '收起侧边栏' : '展开侧边栏'"
          @click="toggleSidebar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-5 h-5"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <h1
          class="text-base sm:text-lg font-semibold text-semi-text-0 truncate flex items-center gap-2"
        >
          <span
            class="hidden sm:inline-flex w-6 h-6 rounded-lg bg-gradient-to-br from-semi-primary to-blue-500 items-center justify-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-3.5 h-3.5"
            >
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          </span>
          {{ $config.public.appTitle || 'AI 对话' }}
        </h1>
        <div class="ml-auto flex items-center gap-1">
          <button
            class="p-2 text-semi-text-3 hover:text-semi-primary hover:bg-semi-primary-light rounded-lg transition-all active:scale-95"
            v-tooltip="'新建会话'"
            @click="createNewSession"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-[18px] h-[18px]"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </header>

      <main ref="messagesContainer" class="flex-1 overflow-y-auto scroll-smooth min-h-0">
        <div
          v-if="messages.length === 0"
          class="flex flex-col items-center min-h-full px-4 sm:px-6 py-6 sm:py-8 pb-32 sm:pb-8 relative"
        >
          <div
            class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(0,100,250,0.05)_0%,_transparent_65%)] pointer-events-none"
          />
          <div class="w-full max-w-lg sm:max-w-xl my-auto flex flex-col items-center">
            <div
              class="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-semi-primary to-blue-500 flex items-center justify-center mb-4 sm:mb-5 shadow-semi-card"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-7 h-7 sm:w-10 sm:h-10"
              >
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <h2 class="text-xl sm:text-3xl font-bold text-semi-text-0 mb-2">有什么可以帮忙的？</h2>
            <p class="text-sm sm:text-base text-semi-text-3 mb-6 sm:mb-10">
              选择一个话题，或直接输入问题开始对话
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 w-full">
              <button
                v-for="prompt in quickPrompts"
                :key="prompt.title"
                class="flex items-start gap-3 px-4 sm:px-5 py-3 sm:py-4 text-left rounded-xl border border-semi-border bg-semi-bg-0 hover:border-semi-primary/30 hover:shadow-semi-elevated hover:-translate-y-0.5 hover:bg-semi-bg-0 active:scale-[0.98] transition-all duration-semi-normal group min-h-[48px] sm:min-h-[60px]"
                @click="useQuickPrompt(prompt.prompt)"
              >
                <span
                  class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-semi-primary-light flex items-center justify-center shrink-0 transition-transform duration-semi-normal group-hover:scale-105 mt-0.5"
                >
                  <QuickPromptIcon
                    :icon="prompt.icon"
                    class="w-[18px] h-[18px] sm:w-5 sm:h-5 text-semi-primary"
                  />
                </span>
                <span class="text-sm text-semi-text-1 font-medium leading-snug">{{
                  prompt.title
                }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-else class="max-w-full sm:max-w-4xl mx-auto py-1 sm:py-6 pb-32 sm:pb-8 px-2 sm:px-4">
          <div
            ref="virtualizerParentRef"
            :style="{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }"
          >
            <div
              v-for="virtualRow in virtualizer.getVirtualItems()"
              :key="String(virtualRow.key)"
              :ref="
                (el) => {
                  if (el) virtualizer.measureElement(el as Element)
                }
              "
              :data-index="virtualRow.index"
              :style="{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`
              }"
              :class="[
                'flex gap-2.5 sm:gap-3 pb-4 sm:pb-5',
                messages[virtualRow.index].role === 'user' ? 'flex-row-reverse' : 'flex-row'
              ]"
            >
              <div
                :class="[
                  'shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center mt-0.5',
                  messages[virtualRow.index].role === 'user'
                    ? 'bg-semi-fill-2 text-semi-text-2'
                    : 'bg-gradient-to-br from-semi-primary to-blue-500 text-white shadow-semi-card'
                ]"
              >
                <svg
                  v-if="messages[virtualRow.index].role === 'user'"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-4 h-4 sm:w-[18px] sm:h-[18px]"
                >
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-4 h-4 sm:w-[18px] sm:h-[18px]"
                >
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
              </div>
              <div
                :data-testid="
                  messages[virtualRow.index].role === 'user' ? 'message-user' : 'message-assistant'
                "
                :class="[
                  'rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 overflow-hidden',
                  messages[virtualRow.index].role === 'user'
                    ? 'max-w-[80%] sm:max-w-[75%] bg-semi-primary-light text-semi-text-0'
                    : 'max-w-[85%] sm:max-w-[80%] bg-semi-bg-0 text-semi-text-0 shadow-semi-card border border-semi-divider/60'
                ]"
              >
                <template v-if="messages[virtualRow.index].role === 'user'">
                  <div v-if="editingIndex === virtualRow.index" class="space-y-2">
                    <textarea
                      v-model="editingText"
                      class="w-full resize-none rounded-xl border border-semi-border bg-semi-bg-0 text-semi-text-0 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-semi-primary/20 min-h-[48px] max-h-[160px]"
                      rows="2"
                      @keydown.enter.prevent="submitEditing(virtualRow.index)"
                      @keydown.escape.prevent="cancelEditing"
                    />
                    <div class="flex items-center gap-2 justify-end">
                      <button
                        class="px-3 py-1.5 text-xs text-semi-text-2 hover:text-semi-text-0 hover:bg-semi-fill-1 rounded-lg transition-colors font-medium"
                        @click="cancelEditing"
                      >
                        取消
                      </button>
                      <button
                        class="px-3 py-1.5 text-xs font-medium text-white bg-semi-primary rounded-lg hover:bg-semi-primary-hover active:scale-95 transition-all"
                        :disabled="!editingText.trim()"
                        @click="submitEditing(virtualRow.index)"
                      >
                        发送
                      </button>
                    </div>
                  </div>
                  <div v-else class="group">
                    <div class="whitespace-pre-wrap break-words leading-relaxed text-[15px]">
                      {{ getMessageText(messages[virtualRow.index]) }}
                    </div>
                    <div
                      v-if="
                        getMessageImages(messages[virtualRow.index].id, virtualRow.index).length
                      "
                      class="flex gap-1.5 mt-2.5 flex-wrap"
                    >
                      <img
                        v-for="img in getMessageImages(
                          messages[virtualRow.index].id,
                          virtualRow.index
                        )"
                        :key="img.id"
                        :src="img.dataUrl"
                        :alt="img.filename"
                        class="w-20 h-20 object-cover rounded-lg border border-semi-primary/10"
                      />
                    </div>
                    <div
                      class="flex justify-end -mr-1 mt-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity"
                    >
                      <button
                        class="p-2 text-semi-text-3 hover:text-semi-text-1 hover:bg-semi-fill-1 rounded-lg transition-all min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                        v-tooltip="'编辑消息'"
                        @click="
                          startEditing(virtualRow.index, getMessageText(messages[virtualRow.index]))
                        "
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          class="w-4 h-4"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          <path d="m15 5 4 4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <LazyThinkingProcess
                    v-if="enableThinking && getReasoningContent(messages[virtualRow.index])"
                    :content="getReasoningContent(messages[virtualRow.index])"
                    :is-expanded="expandedThinkingMap.get(messages[virtualRow.index].id) || false"
                    @toggle="toggleThinkingExpand(messages[virtualRow.index].id)"
                  />

                  <div
                    v-if="getVisibleToolInvocations(messages[virtualRow.index]).length > 0"
                    class="mb-3 space-y-2"
                  >
                    <LazyToolInvocation
                      v-for="invocation in getVisibleToolInvocations(messages[virtualRow.index])"
                      :key="invocation.toolCallId"
                      :invocation="invocation"
                    />
                  </div>

                  <div class="relative inline">
                    <MarkdownRenderer
                      v-if="getMessageText(messages[virtualRow.index])"
                      :content="getMessageText(messages[virtualRow.index])"
                    />
                    <span
                      v-if="isLastMessageLoading && virtualRow.index === messages.length - 1"
                      class="inline-flex items-center gap-0.5 ml-1 align-middle"
                    >
                      <span
                        class="typing-dot w-1.5 h-1.5 rounded-full bg-semi-primary inline-block"
                      />
                      <span
                        class="typing-dot w-1.5 h-1.5 rounded-full bg-semi-primary inline-block"
                        style="animation-delay: 0.15s"
                      />
                      <span
                        class="typing-dot w-1.5 h-1.5 rounded-full bg-semi-primary inline-block"
                        style="animation-delay: 0.3s"
                      />
                    </span>
                  </div>

                  <div
                    v-if="getMessageText(messages[virtualRow.index])"
                    class="flex items-center gap-0.5 mt-2 -ml-1"
                  >
                    <button
                      class="p-2 text-semi-text-3 hover:text-semi-primary hover:bg-semi-primary-light rounded-lg transition-all min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                      v-tooltip="'复制'"
                      @click="
                        copyMessage(
                          getMessageText(messages[virtualRow.index]),
                          messages[virtualRow.index].id
                        )
                      "
                    >
                      <svg
                        v-if="copiedMessageId !== messages[virtualRow.index].id"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-4 h-4"
                      >
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-4 h-4 text-semi-success"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      class="p-2 text-semi-text-3 hover:text-semi-primary hover:bg-semi-primary-light rounded-lg transition-all min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                      v-tooltip="'重新生成'"
                      :disabled="isLoading"
                      @click="handleReload"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-4 h-4"
                      >
                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                        <path d="M16 16h5v5" />
                      </svg>
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </main>

      <ChatInput
        v-model:input="input"
        :is-loading="isLoading"
        v-model:enable-thinking="enableThinking"
        v-model:enable-web-search="enableWebSearch"
        v-model:enable-ocr="enableOcr"
        v-model:images="uploadedImages"
        :supports-vision="supportsVision"
        :supports-ocr="currentSupportsOcr"
        :current-capabilities="currentCapabilities"
        :model-options="modelOptions"
        :current-model="currentModel"
        @select-model="currentModel = $event"
        @submit="wrappedHandleSubmit"
        @stop="handleStop"
        @speech-error="(msg: string) => toast.error(msg)"
      />
    </div>
  </div>
</template>

<style scoped>
.slide-left-enter-active,
.slide-left-leave-active {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.slide-left-enter-from,
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

.sidebar-enter-active,
.sidebar-leave-active {
  transition:
    margin-left theme('transitionDuration.semi-slow') ease,
    opacity theme('transitionDuration.semi-slow') ease;
}

.sidebar-enter-from,
.sidebar-leave-to {
  margin-left: calc(theme('spacing.semi-sidebar') * -1);
  opacity: 0;
}

.typing-dot {
  animation: typingBounce 1.2s infinite ease-in-out;
}

@keyframes typingBounce {
  0%,
  60%,
  100% {
    opacity: 0.4;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-4px);
  }
}
</style>
