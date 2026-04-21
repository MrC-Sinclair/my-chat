<!--
  @component 思考过程展示组件
  @file components/chat/ThinkingProcess.vue

  展示推理模型的思考过程（reasoning_content），
  默认折叠，点击可展开查看完整思考链。

  Props：
    - content: 思考过程文本内容
-->
<script setup lang="ts">
defineProps<{
  /** 思考过程文本内容 */
  content: string
}>()

/** 是否展开思考过程 */
const isExpanded = ref(false)
</script>

<template>
  <div class="thinking-process mb-3">
    <!-- 折叠/展开按钮 -->
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors w-full text-left"
      @click="isExpanded = !isExpanded"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3.5 h-3.5 shrink-0 transition-transform"
        :class="{ 'rotate-90': isExpanded }"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      🧠 思考过程
      <span class="text-amber-500 ml-1">{{ isExpanded ? '点击收起' : '点击展开' }}</span>
    </button>

    <!-- 思考内容区域 -->
    <div
      v-if="isExpanded"
      class="mt-2 px-3 py-2 bg-amber-50/50 border border-amber-100 rounded-lg text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto"
    >
      {{ content }}
    </div>
  </div>
</template>
