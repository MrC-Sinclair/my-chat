<script setup lang="ts">
import { useChat } from '@ai-sdk/vue'
import MarkdownRenderer from '~/components/chat/MarkdownRenderer.vue'
import SessionSidebar from '~/components/chat/SessionSidebar.vue'
import ToolInvocation from '~/components/chat/ToolInvocation.vue'
import ChatInput, { type UploadedImage } from '~/components/chat/ChatInput.vue'
import ThinkingProcess from '~/components/chat/ThinkingProcess.vue'
import { useChatSession } from '~/composables/useChatSession'
import { useChatConfig } from '~/composables/useChatConfig'
import { useToast } from '~/composables/useToast'

const {
  enableThinking,
  enableWebSearch,
  currentModel,
  showSidebar,
  modelOptions,
  thinkingBudget,
  supportsVision,
  currentCapabilities
} = useChatConfig()
const toast = useToast()

const uploadedImages = ref<UploadedImage[]>([])
const pendingMessageImages = ref<UploadedImage[]>([])
const messageImages = ref<Map<string, UploadedImage[]>>(new Map())
const nextMessageIndex = ref<number>(0)

const { messages, input, handleSubmit, isLoading, stop, reload, setMessages } = useChat({
  api: '/api/chat',
  body: computed(() => ({
    sessionId: currentSessionId.value || undefined,
    enable_thinking: enableThinking.value,
    thinking_budget: enableThinking.value ? thinkingBudget : undefined,
    model: currentModel.value,
    enable_web_search: enableWebSearch.value,
    images:
      uploadedImages.value.length > 0 ? uploadedImages.value.map((img) => img.dataUrl) : undefined
  })),
  onFinish: () => {
    uploadedImages.value = []
    if (pendingMessageImages.value.length > 0) {
      nextTick(() => {
        const targetMsg = messages.value[nextMessageIndex.value]
        console.log(
          '[chat] onFinish, targetMsg:',
          targetMsg?.id,
          targetMsg?.role,
          targetMsg?.content
        )
        if (targetMsg && targetMsg.role === 'user') {
          messageImages.value.set(targetMsg.id, [...pendingMessageImages.value])
          console.log('[chat] images associated to msg:', targetMsg.id)
        }
        pendingMessageImages.value = []
      })
    }
  },
  onError: (err) => {
    uploadedImages.value = []
    if (pendingMessageImages.value.length > 0) {
      const targetMsg = messages.value[nextMessageIndex.value]
      if (targetMsg && targetMsg.role === 'user') {
        messageImages.value.set(targetMsg.id, [...pendingMessageImages.value])
      }
    }
    pendingMessageImages.value = []
    toast.error(`AI 回复失败：${err.message || '未知错误'}`)
  }
})

const originalHandleSubmit = handleSubmit
const wrappedHandleSubmit = () => {
  if (uploadedImages.value.length > 0) {
    pendingMessageImages.value = [...uploadedImages.value]
  }
  nextMessageIndex.value = messages.value.length
  originalHandleSubmit()
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

const editingIndex = ref(-1)
const editingText = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const copiedMessageId = ref<string>('')
const modelDropdownOpen = ref(false)
const modelDropdownRef = ref<HTMLElement | null>(null)

const currentModelLabel = computed(() => {
  const found = modelOptions.value.find((opt) => opt.value === currentModel.value)
  return found?.label || currentModel.value
})

function selectModel(value: string) {
  currentModel.value = value
  modelDropdownOpen.value = false
}

function handleModelDropdownClick(e: MouseEvent) {
  if (modelDropdownRef.value && !modelDropdownRef.value.contains(e.target as Node)) {
    modelDropdownOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleModelDropdownClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleModelDropdownClick)
})
const localIsLoading = ref(false)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

watch(isLoading, (loading) => {
  localIsLoading.value = loading
})

watch(
  messages,
  (newMessages) => {
    const lastMsg = newMessages[newMessages.length - 1]
  },
  { deep: true }
)

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

function getToolInvocations(msg: any): any[] {
  const invocations = msg.toolInvocations
  if (!Array.isArray(invocations)) return []
  return invocations
}

function getReasoningContent(msg: any): string {
  return msg.reasoningContent || ''
}

function startEditing(index: number, content: string) {
  editingIndex.value = index
  editingText.value = content
}

function cancelEditing() {
  editingIndex.value = -1
  editingText.value = ''
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

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTo({
        top: messagesContainer.value.scrollHeight,
        behavior: 'smooth'
      })
    }
  })
}

watch(
  () => messages.value.length,
  () => scrollToBottom()
)

watch(
  () => messages.value[messages.value.length - 1]?.content,
  () => {
    if (isLoading.value) {
      scrollToBottom()
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

async function handleReload() {
  try {
    await reload()
  } catch {
    toast.error('重新生成失败，请重试')
  }
}

const quickPrompts = [
  { icon: '☀️', text: '今天天气怎么样？' },
  { icon: '💻', text: '用 Python 写一个贪吃蛇游戏' },
  { icon: '🔬', text: '用简单的语言解释一下相对论' },
  { icon: '🎬', text: '推荐几部好看的科幻电影' },
  { icon: '🌐', text: '把这段文字翻译成英文' },
  { icon: '✉️', text: '帮我写一封商务邮件' }
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
  const target = e.target as HTMLElement
  if (target.closest('header')) return
  const sidebarEl = target.closest('[data-mobile-sidebar]')
  if (!sidebarEl) {
    showSidebar.value = false
  }
}
</script>

<template>
  <div class="flex h-screen bg-white">
    <!-- Mobile sidebar panel -->
    <div
      v-if="showSidebar"
      data-mobile-sidebar
      class="fixed inset-0 z-50 sm:hidden"
      style="background: rgba(0, 0, 0, 0.5)"
      @click.self="closeSidebar"
    >
      <div class="absolute inset-y-0 left-0 w-[85vw] bg-gray-50">
        <SessionSidebar
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

    <!-- Desktop sidebar (inline in flex flow) -->
    <div class="hidden sm:flex">
      <Transition name="sidebar">
        <SessionSidebar
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
        class="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2 sm:py-3 border-b border-gray-200 bg-white shrink-0"
      >
        <button
          class="p-2 sm:p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100 active:scale-95 transition-all"
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
        <h1 class="text-base sm:text-xl font-semibold text-gray-800 truncate">
          {{ $config.public.appTitle || 'AI 对话' }}
        </h1>

        <div class="relative" ref="modelDropdownRef">
          <button
            class="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 active:scale-95 transition-all min-h-[36px] text-gray-700"
            v-tooltip:bottom="'切换模型'"
            @click="modelDropdownOpen = !modelDropdownOpen"
          >
            <span class="max-w-[80px] sm:max-w-[140px] truncate">{{ currentModelLabel }}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-3.5 h-3.5 transition-transform duration-200"
              :class="modelDropdownOpen ? 'rotate-180' : ''"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <Transition name="dropdown-fade">
            <div
              v-if="modelDropdownOpen"
              class="absolute top-full mt-1 right-0 sm:left-0 sm:right-auto w-52 sm:w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden"
            >
              <div class="py-1">
                <button
                  v-for="opt in modelOptions"
                  :key="opt.value"
                  class="w-full text-left px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm transition-colors duration-150 flex items-center gap-2 min-h-[36px]"
                  :class="
                    currentModel === opt.value
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  "
                  @click="selectModel(opt.value)"
                >
                  <svg
                    v-if="currentModel === opt.value"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-3.5 h-3.5 shrink-0"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span v-else class="w-3.5 h-3.5 shrink-0" />
                  <span class="truncate">{{ opt.label }}</span>
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </header>

      <main ref="messagesContainer" class="flex-1 overflow-y-auto scroll-smooth">
        <div
          v-if="messages.length === 0"
          class="flex flex-col items-center justify-center h-full px-4"
        >
          <h2 class="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">有什么可以帮忙的？</h2>
          <p class="text-sm sm:text-base text-gray-400 mb-8 sm:mb-10">
            选择一个话题，或直接输入问题开始对话
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full max-w-lg sm:max-w-xl">
            <button
              v-for="prompt in quickPrompts"
              :key="prompt.text"
              class="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-3.5 text-left rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm hover:bg-gray-50 active:scale-[0.98] transition-all duration-200 group min-h-[44px] sm:min-h-0"
              @click="useQuickPrompt(prompt.text)"
            >
              <span
                class="text-lg sm:text-xl shrink-0 group-hover:scale-110 transition-transform duration-200"
                >{{ prompt.icon }}</span
              >
              <span class="text-sm text-gray-600 truncate">{{ prompt.text }}</span>
            </button>
          </div>
        </div>

        <div v-else class="max-w-full sm:max-w-4xl mx-auto py-1 sm:py-6 px-2 sm:px-4">
          <TransitionGroup name="message" tag="div" class="space-y-2 sm:space-y-6">
            <div
              v-for="(msg, index) in messages"
              :key="msg.id || index"
              :class="[
                'rounded-xl sm:rounded-2xl px-2.5 sm:px-5 py-1.5 sm:py-3 overflow-hidden',
                msg.role === 'user'
                  ? 'ml-auto max-w-[92%] sm:max-w-[85%] bg-gray-100 text-gray-800 message-user'
                  : 'mr-auto max-w-[96%] sm:max-w-[90%] bg-gray-50 text-gray-800 message-assistant'
              ]"
            >
              <template v-if="msg.role === 'user'">
                <div v-if="editingIndex === index" class="space-y-2">
                  <textarea
                    v-model="editingText"
                    class="w-full resize-none rounded-xl border border-gray-200 bg-white text-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300/50 min-h-[48px] max-h-[160px]"
                    rows="2"
                    @keydown.enter.prevent="submitEditing(index)"
                    @keydown.escape.prevent="cancelEditing"
                  />
                  <div class="flex items-center gap-2 justify-end">
                    <button
                      class="px-3 py-1.5 text-xs text-gray-800 hover:text-gray-900 rounded-lg transition-colors font-medium"
                      @click="cancelEditing"
                    >
                      取消
                    </button>
                    <button
                      class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:scale-95 transition-all"
                      :disabled="!editingText.trim()"
                      @click="submitEditing(index)"
                    >
                      发送
                    </button>
                  </div>
                </div>
                <div v-else class="group">
                  <div class="whitespace-pre-wrap break-words leading-relaxed">
                    {{ msg.content }}
                  </div>
                  <div
                    v-if="getMessageImages(msg.id, index).length"
                    class="flex gap-1.5 mt-2 flex-wrap"
                  >
                    <img
                      v-for="img in getMessageImages(msg.id, index)"
                      :key="img.id"
                      :src="img.dataUrl"
                      :alt="img.filename"
                      class="w-20 h-20 object-cover rounded-lg border border-gray-200"
                    />
                  </div>
                  <div
                    class="flex justify-end mt-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity"
                  >
                    <button
                      class="p-1.5 sm:p-1 text-gray-400 hover:text-gray-600 rounded transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                      v-tooltip="'编辑消息'"
                      @click="startEditing(index, msg.content)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="w-3.5 h-3.5"
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                  </div>
                </div>
              </template>

              <template v-else>
                <ThinkingProcess
                  v-if="enableThinking && getReasoningContent(msg)"
                  :content="getReasoningContent(msg)"
                />

                <div v-if="getToolInvocations(msg).length > 0" class="mb-3 space-y-2">
                  <ToolInvocation
                    v-for="invocation in getToolInvocations(msg)"
                    :key="invocation.toolCallId"
                    :invocation="invocation"
                  />
                </div>

                <div class="relative inline">
                  <MarkdownRenderer v-if="msg.content" :content="msg.content" />
                  <span
                    v-if="isLastMessageLoading && index === messages.length - 1"
                    class="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 cursor-blink align-text-bottom"
                  />
                </div>

                <div
                  v-if="msg.content"
                  class="flex items-center gap-1 mt-1.5 sm:mt-2 pt-1.5 sm:pt-2 border-t border-gray-100 sm:border-gray-200"
                >
                  <button
                    class="p-1.5 sm:p-1 text-gray-400 hover:text-blue-600 rounded transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                    v-tooltip="'复制'"
                    @click="copyMessage(msg.content, msg.id)"
                  >
                    <svg
                      v-if="copiedMessageId !== msg.id"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="w-3.5 h-3.5"
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
                      class="w-3.5 h-3.5 text-green-500"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button
                    class="p-1.5 sm:p-1 text-gray-400 hover:text-blue-600 rounded transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
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
                      class="w-3.5 h-3.5"
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
          </TransitionGroup>
        </div>
      </main>

      <ChatInput
        v-model:input="input"
        :is-loading="isLoading"
        v-model:enable-thinking="enableThinking"
        v-model:enable-web-search="enableWebSearch"
        v-model:images="uploadedImages"
        :supports-vision="supportsVision"
        :current-capabilities="currentCapabilities"
        @submit="wrappedHandleSubmit"
        @stop="stop"
      />
    </div>
  </div>
</template>

<style scoped>
.sidebar-enter-active,
.sidebar-leave-active {
  transition:
    margin-left 0.25s ease,
    opacity 0.25s ease;
}
.sidebar-enter-from,
.sidebar-leave-to {
  margin-left: -256px;
  opacity: 0;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: all 0.15s ease;
}
.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: scaleY(0.9) translateY(-4px);
}

.message-enter-active {
  transition: all 0.3s ease-out;
}
.message-leave-active {
  transition: all 0.15s ease-in;
}
.message-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.message-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
