<!--
  @component 聊天输入区域组件
  @file components/chat/ChatInput.vue

  从 ai-chat.vue 中抽离的输入区域组件，负责：
    - 消息输入框（支持多行、Enter 发送）
    - 发送/停止按钮
    - 深度思考模式切换
    - 模型选择下拉框

  Props：
    - input: 输入框绑定值 (v-model)
    - isLoading: AI 是否正在生成
    - enableThinking: 是否开启深度思考
    - currentModel: 当前选中的模型
    - modelOptions: 可用模型列表

  Events：
    - update:input: 更新输入框内容
    - submit: 提交消息
    - stop: 停止生成
    - update:enableThinking: 切换思考模式
    - update:currentModel: 切换模型
-->
<script setup lang="ts">
import type { ModelOption } from '~/composables/useChatConfig'

const props = defineProps<{
  /** 输入框绑定值 */
  input: string
  /** AI 是否正在生成 */
  isLoading: boolean
  /** 是否开启深度思考 */
  enableThinking: boolean
  /** 当前选中的模型 */
  currentModel: string
  /** 可用模型列表 */
  modelOptions: ModelOption[]
}>()

const emit = defineEmits<{
  /** 更新输入框内容 */
  'update:input': [value: string]
  /** 提交消息 */
  submit: []
  /** 停止生成 */
  stop: []
  /** 切换思考模式 */
  'update:enableThinking': [value: boolean]
  /** 切换模型 */
  'update:currentModel': [value: string]
}>()

/** 输入框内容的双向绑定 */
const inputValue = computed({
  get: () => props.input,
  set: (val: string) => emit('update:input', val)
})

/** 处理 Enter 键提交 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <footer class="shrink-0 border-t border-gray-200 bg-white p-4">
    <form class="max-w-4xl mx-auto" @submit.prevent="emit('submit')">
      <div class="flex items-end gap-2">
        <!-- 输入框 -->
        <textarea
          :value="inputValue"
          data-testid="chat-input"
          class="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[48px] max-h-[160px]"
          placeholder="输入你的问题..."
          rows="1"
          :disabled="isLoading"
          @input="inputValue = ($event.target as HTMLTextAreaElement).value"
          @keydown="handleKeydown"
        />
        <!-- 发送按钮 -->
        <button
          v-if="!isLoading"
          type="submit"
          data-testid="send-btn"
          :disabled="!input.trim()"
          class="shrink-0 p-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          发送 ▶
        </button>
        <!-- 停止按钮 -->
        <button
          v-else
          type="button"
          data-testid="stop-btn"
          class="shrink-0 p-3 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors"
          @click="emit('stop')"
        >
          停止 ■
        </button>
      </div>

      <!-- 底部控制栏 -->
      <div class="flex items-center gap-2 mt-2">
        <!-- 深度思考切换按钮 -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          :class="
            enableThinking
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-300'
          "
          :title="enableThinking ? '深度思考已开启（更准但较慢）' : '快速模式（关闭深度思考）'"
          @click="emit('update:enableThinking', !enableThinking)"
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
            <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
            <path d="M12 12V2a10 10 0 0 1 8.66 14.34" />
          </svg>
          思考
        </button>

        <!-- 模型选择下拉框 -->
        <select
          :value="currentModel"
          class="px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          @change="emit('update:currentModel', ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="opt in modelOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>

        <!-- 当前模式提示 -->
        <span class="text-xs text-gray-400 ml-auto">
          {{ enableThinking ? '🧠 深度思考模式' : '⚡ 快速模式' }}
        </span>
      </div>
    </form>
  </footer>
</template>
