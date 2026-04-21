<!--
  @component AI 聊天页面
  @file pages/ai-chat.vue

  核心聊天页面，实现了完整的聊天交互界面。

  页面布局（从左到右）：
    ┌──────────┬──────────────────────────┐
    │          │        顶部标题栏         │
    │  会话    ├──────────────────────────┤
    │  列表    │                          │
    │  侧边栏  │      聊天消息区域         │
    │          │                          │
    │          ├──────────────────────────┤
    │          │      输入框 + 控制栏      │
    └──────────┴──────────────────────────┘

  核心功能：
    1. 会话管理：新建、切换、删除聊天会话（useChatSession）
    2. 流式聊天：通过 Vercel AI SDK 的 useChat 实现逐字输出
    3. 深度思考模式：可切换"快速模式"和"深度思考模式"（useChatConfig）
    4. 模型切换：前端选择不同模型
    5. Markdown 渲染：AI 回复支持公式、代码块等富文本
    6. 思考过程展示：展示推理模型的 reasoning_content
    7. 消息编辑：编辑已发送的用户消息并重新生成回复
    8. 重新生成：对 AI 回复重新生成

  数据流：
    前端 useChat → POST /api/chat → LLM 流式生成 → 逐字显示
                                        ↓ (onFinish)
                                    保存到数据库
-->
<script setup lang="ts">
import { useChat } from '@ai-sdk/vue'
import MarkdownRenderer from '~/components/chat/MarkdownRenderer.vue'
import SessionSidebar from '~/components/chat/SessionSidebar.vue'
import ToolInvocation from '~/components/chat/ToolInvocation.vue'
import ChatInput from '~/components/chat/ChatInput.vue'
import ThinkingProcess from '~/components/chat/ThinkingProcess.vue'
import { useChatSession } from '~/composables/useChatSession'
import { useChatConfig } from '~/composables/useChatConfig'

/** 聊天配置：思考模式、模型选择、侧边栏 */
const { enableThinking, currentModel, showSidebar, modelOptions, thinkingBudget } = useChatConfig()

/**
 * useChat — Vercel AI SDK 提供的 Vue 组合式函数
 *
 * body 参数使用 computed，确保每次请求都携带最新的配置：
 *   - sessionId: 当前会话 ID，后端据此保存对话记录
 *   - enable_thinking / thinking_budget: 深度思考相关配置
 *   - model: 前端选择的模型
 */
const { messages, input, handleSubmit, isLoading, stop, reload, setMessages } = useChat({
  api: '/api/chat',
  body: computed(() => ({
    sessionId: currentSessionId.value || undefined,
    enable_thinking: enableThinking.value,
    thinking_budget: enableThinking.value ? thinkingBudget : undefined,
    model: currentModel.value
  }))
})

/** 会话管理 */
const { sessionsList, currentSessionId, loadSessions, createNewSession, switchSession, deleteSession } =
  useChatSession(setMessages)

/** 正在编辑的消息索引，-1 表示没有在编辑 */
const editingIndex = ref(-1)

/** 编辑中的文本内容 */
const editingText = ref('')

/** 页面挂载时加载会话列表 */
onMounted(async () => {
  await loadSessions()
})

/**
 * 获取消息的工具调用列表
 *
 * @param msg - 聊天消息对象
 * @returns 工具调用数组
 */
function getToolInvocations(msg: any): any[] {
  const invocations = msg.toolInvocations
  if (!Array.isArray(invocations)) return []
  return invocations
}

/**
 * 获取消息的思考过程内容
 *
 * @param msg - 聊天消息对象
 * @returns 思考过程文本，没有则返回空字符串
 */
function getReasoningContent(msg: any): string {
  return msg.reasoningContent || ''
}

/**
 * 开始编辑用户消息
 *
 * 点击编辑按钮后，将消息内容加载到编辑框中，
 * 并记录正在编辑的消息索引。
 *
 * @param index - 消息在 messages 数组中的索引
 * @param content - 消息原始内容
 */
function startEditing(index: number, content: string) {
  editingIndex.value = index
  editingText.value = content
}

/**
 * 取消编辑
 */
function cancelEditing() {
  editingIndex.value = -1
  editingText.value = ''
}

/**
 * 提交编辑后的消息
 *
 * 编辑用户消息后，截断该消息之后的所有消息，
 * 然后用编辑后的内容重新发送。
 * 这相当于从编辑点重新开始对话。
 *
 * @param index - 被编辑消息的索引
 */
function submitEditing(index: number) {
  const newContent = editingText.value.trim()
  if (!newContent) return

  // 截断到被编辑的消息之前，然后用新内容替换
  const truncatedMessages = messages.value.slice(0, index)
  setMessages(truncatedMessages)

  // 设置输入框内容并提交
  input.value = newContent
  nextTick(() => {
    handleSubmit()
  })

  cancelEditing()
}
</script>

<template>
  <!-- 最外层容器 -->
  <div class="flex h-screen bg-white">
    <!-- 侧边栏：会话列表 -->
    <SessionSidebar
      v-if="showSidebar"
      :sessions-list="sessionsList"
      :current-session-id="currentSessionId"
      @create="createNewSession"
      @switch="switchSession"
      @delete="deleteSession"
    />

    <!-- 主聊天区域 -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- 顶部标题栏 -->
      <header
        data-testid="chat-header"
        class="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white shrink-0"
      >
        <button
          class="p-1.5 text-gray-500 hover:text-gray-800 rounded hover:bg-gray-100 transition-colors"
          :class="{ 'rotate-180': !showSidebar }"
          @click="showSidebar = !showSidebar"
          :title="showSidebar ? '收起侧边栏' : '展开侧边栏'"
        >
          ☰
        </button>
        <h1 class="text-xl font-semibold text-gray-800">
          {{ $config.public.appTitle }}
        </h1>
        <div class="ml-auto flex items-center gap-2">
          <button
            class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
            @click="createNewSession"
          >
            新会话
          </button>
        </div>
      </header>

      <!-- 聊天消息区域 -->
      <main class="flex-1 overflow-y-auto">
        <!-- 空状态 -->
        <div
          v-if="messages.length === 0"
          class="flex flex-col items-center justify-center h-full text-gray-400"
        >
          <p class="text-lg">开始一段新的对话吧</p>
          <p class="mt-2 text-sm">我是你的AI助手，随时为你解答问题</p>
          <button
            class="mt-4 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
            @click="createNewSession"
          >
            + 开始新对话
          </button>
        </div>

        <!-- 消息列表 -->
        <div v-else class="max-w-4xl mx-auto py-6 space-y-6 px-4">
          <div
            v-for="(msg, index) in messages"
            :key="index"
            :class="[
              'rounded-2xl px-5 py-3 overflow-hidden',
              msg.role === 'user'
                ? 'ml-auto max-w-[80%] bg-blue-600 text-white message-user'
                : 'mr-auto max-w-[85%] bg-gray-50 text-gray-800 message-assistant'
            ]"
          >
            <!-- 用户消息 -->
            <template v-if="msg.role === 'user'">
              <!-- 编辑模式 -->
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
                    class="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
                    :disabled="!editingText.trim()"
                    @click="submitEditing(index)"
                  >
                    发送
                  </button>
                </div>
              </div>
              <!-- 普通显示模式 -->
              <div v-else class="group">
                <div class="whitespace-pre-wrap leading-relaxed">{{ msg.content }}</div>
                <!-- 编辑按钮：鼠标悬停时显示 -->
                <div class="flex justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    class="p-1 text-blue-200 hover:text-white rounded transition-colors"
                    title="编辑消息"
                    @click="startEditing(index, msg.content)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                </div>
              </div>
            </template>

            <!-- AI 助手消息 -->
            <template v-else>
              <!-- 思考过程展示 -->
              <ThinkingProcess
                v-if="getReasoningContent(msg)"
                :content="getReasoningContent(msg)"
              />

              <!-- 工具调用展示 -->
              <div
                v-if="getToolInvocations(msg).length > 0"
                class="mb-3 space-y-2"
              >
                <ToolInvocation
                  v-for="invocation in getToolInvocations(msg)"
                  :key="invocation.toolCallId"
                  :invocation="invocation"
                />
              </div>

              <!-- Markdown 渲染区域 -->
              <MarkdownRenderer v-if="msg.content" :content="msg.content" />

              <!-- 打字光标动画 -->
              <div
                v-if="isLoading && index === messages.length - 1 && !msg.content"
                class="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse cursor-blink mt-1"
              />

              <!-- 消息操作按钮 -->
              <div
                v-if="msg.content"
                class="flex items-center gap-1 mt-2 pt-2 border-t border-gray-200"
              >
                <button
                  class="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                  title="重新生成"
                  :disabled="isLoading"
                  @click="() => reload()"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
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
      </main>

      <!-- 底部输入区域 -->
      <ChatInput
        v-model:input="input"
        :is-loading="isLoading"
        v-model:enable-thinking="enableThinking"
        v-model:current-model="currentModel"
        :model-options="modelOptions"
        @submit="handleSubmit"
        @stop="stop"
      />
    </div>
  </div>
</template>
