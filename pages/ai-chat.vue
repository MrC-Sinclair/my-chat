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

const { enableThinking, currentModel, showSidebar, modelOptions, thinkingBudget, supportsVision } =
  useChatConfig()
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
const localIsLoading = ref(false)
const isMobile = ref(false)

function checkMobile() {
  isMobile.value = window.innerWidth < 640
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
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
</script>

<template>
  <div class="flex h-screen bg-white">
    <!-- Mobile sidebar backdrop -->
    <Transition name="fade">
      <div
        v-if="isMobile && showSidebar"
        class="fixed inset-0 z-40 bg-black/50 sm:hidden"
        @click="showSidebar = false"
      />
    </Transition>

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

    <!-- Mobile sidebar (overlay) -->
    <Transition name="slide-left">
      <div v-if="isMobile && showSidebar" class="fixed inset-y-0 left-0 z-50 sm:hidden">
        <SessionSidebar
          :sessions-list="sessionsList"
          :current-session-id="currentSessionId"
          @create="createNewSession"
          @switch="switchSession"
          @delete="deleteSession"
          @rename="renameSession"
          @close="showSidebar = false"
        />
      </div>
    </Transition>

    <div class="flex-1 flex flex-col min-w-0">
      <header
        data-testid="chat-header"
        class="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2 sm:py-3 border-b border-gray-200 bg-white shrink-0"
      >
        <button
          class="p-2 sm:p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100 active:scale-95 transition-all"
          v-tooltip:bottom="showSidebar ? '收起侧边栏' : '展开侧边栏'"
          @click="showSidebar = !showSidebar"
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
        <button
          class="ml-auto px-2 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 active:scale-95 transition-all min-w-[44px] flex items-center justify-center"
          v-tooltip="'新会话'"
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
            class="w-4 h-4 sm:hidden"
          >
            <path d="M12 5v14" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span class="hidden sm:inline">新会话</span>
        </button>
      </header>

      <main ref="messagesContainer" class="flex-1 overflow-y-auto scroll-smooth">
        <div
          v-if="messages.length === 0"
          class="flex flex-col items-center justify-center h-full text-gray-400"
        >
          <div class="text-4xl sm:text-5xl mb-3 sm:mb-4">💬</div>
          <p class="text-base sm:text-lg">开始一段新的对话吧</p>
          <p class="mt-1 sm:mt-2 text-xs sm:text-sm">我是你的AI助手，随时为你解答问题</p>
          <button
            class="mt-3 sm:mt-4 px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:scale-95 transition-all"
            @click="createNewSession"
          >
            + 开始新对话
          </button>
        </div>

        <div v-else class="max-w-full sm:max-w-4xl mx-auto py-1 sm:py-6 px-2 sm:px-4">
          <TransitionGroup name="message" tag="div" class="space-y-2 sm:space-y-6">
            <div
              v-for="(msg, index) in messages"
              :key="msg.id || index"
              :class="[
                'rounded-xl sm:rounded-2xl px-2.5 sm:px-5 py-1.5 sm:py-3 overflow-hidden',
                msg.role === 'user'
                  ? 'ml-auto max-w-[92%] sm:max-w-[85%] bg-blue-600 text-white message-user'
                  : 'mr-auto max-w-[96%] sm:max-w-[90%] bg-gray-50 text-gray-800 message-assistant'
              ]"
            >
              <template v-if="msg.role === 'user'">
                <div v-if="editingIndex === index" class="space-y-2">
                  <textarea
                    v-model="editingText"
                    class="w-full resize-none rounded-lg border border-blue-400 bg-white text-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] max-h-[160px]"
                    rows="2"
                    @keydown.enter.prevent="submitEditing(index)"
                    @keydown.escape.prevent="cancelEditing"
                  />
                  <div class="flex items-center gap-2 justify-end">
                    <button
                      class="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 rounded transition-colors"
                      @click="cancelEditing"
                    >
                      取消
                    </button>
                    <button
                      class="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 active:scale-95 transition-all"
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
                      class="w-20 h-20 object-cover rounded-lg border border-blue-300/50"
                    />
                  </div>
                  <div
                    class="flex justify-end mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 sm:transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <button
                      class="p-1.5 sm:p-1 text-blue-200 hover:text-white rounded transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
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
                  v-if="getReasoningContent(msg)"
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
        v-model:current-model="currentModel"
        v-model:images="uploadedImages"
        :model-options="modelOptions"
        :supports-vision="supportsVision"
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

/* Mobile sidebar slide-in */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.25s ease;
}
.slide-left-enter-from,
.slide-left-leave-to {
  transform: translateX(-100%);
}

/* Mobile backdrop fade */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
