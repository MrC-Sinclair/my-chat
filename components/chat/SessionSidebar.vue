<!--
  @component 会话列表侧边栏
  @file components/chat/SessionSidebar.vue

  从 ai-chat.vue 中抽离的侧边栏组件，负责：
    - 显示会话列表
    - 新建会话按钮
    - 切换/删除会话

  Props：
    - sessionsList: 会话列表数据
    - currentSessionId: 当前选中的会话 ID

  Events：
    - create: 点击新建会话
    - switch: 切换到指定会话（参数: sessionId）
    - delete: 删除指定会话（参数: sessionId）
-->
<script setup lang="ts">
import type { SessionItem } from '~/composables/useChatSession'

defineProps<{
  /** 会话列表数据 */
  sessionsList: SessionItem[]
  /** 当前选中的会话 ID */
  currentSessionId: string
}>()

const emit = defineEmits<{
  /** 点击新建会话 */
  create: []
  /** 切换到指定会话 */
  switch: [sessionId: string]
  /** 删除指定会话 */
  delete: [sessionId: string]
}>()

/** 处理删除，阻止事件冒泡后触发 delete 事件 */
function handleDelete(sessionId: string, event: Event) {
  event.stopPropagation()
  emit('delete', sessionId)
}
</script>

<template>
  <aside class="w-64 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
    <!-- 新建会话按钮 -->
    <div class="p-4 border-b border-gray-200">
      <button
        class="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
        @click="emit('create')"
      >
        <span class="text-lg">+</span>
        新建会话
      </button>
    </div>

    <!-- 会话列表区域 -->
    <div class="flex-1 overflow-y-auto p-2">
      <!-- 空状态 -->
      <div v-if="sessionsList.length === 0" class="text-sm text-gray-400 text-center py-8">
        暂无会话
      </div>

      <!-- 单个会话项 -->
      <div
        v-for="session in sessionsList"
        :key="session.id"
        class="group flex items-center justify-between px-3 py-2.5 mb-1 rounded-lg cursor-pointer transition-colors"
        :class="
          session.id === currentSessionId
            ? 'bg-blue-100 text-blue-800'
            : 'hover:bg-gray-200 text-gray-700'
        "
        @click="emit('switch', session.id)"
      >
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">{{ session.title }}</div>
          <div class="text-xs text-gray-400 mt-0.5">{{ session.messageCount || 0 }} 条消息</div>
        </div>
        <UTooltip text="删除会话">
          <button
            class="opacity-0 group-hover:opacity-100 ml-2 p-1 text-red-500 hover:text-red-700 rounded transition-all"
            @click="handleDelete(session.id, $event)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </UTooltip>
      </div>
    </div>
  </aside>
</template>
