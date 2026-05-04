<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  content: string
  isExpanded: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()

/**
 * 将思考内容按段落拆分，用于结构化展示
 * 空行作为段落分隔符
 */
const paragraphs = computed(() => {
  return props.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
})

/** 判断内容是否为空或只有空白 */
const hasContent = computed(() => props.content && props.content.trim().length > 0)
</script>

<template>
  <div v-if="hasContent" class="thinking-process mb-2 sm:mb-3">
    <!-- 折叠状态：简洁的头部条 -->
    <button
      class="group flex items-center gap-2 w-full text-left px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 active:scale-[0.98] transition-all duration-200 border border-gray-200/60"
      @click="emit('toggle')"
    >
      <!-- 脉冲动画点 -->
      <span class="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"
        />
        <span class="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-indigo-500" />
      </span>

      <!-- 标题 -->
      <span class="text-xs sm:text-sm font-medium text-gray-600 flex-1">
        已深度思考
      </span>

      <!-- 展开/收起指示 -->
      <span class="text-[10px] sm:text-xs text-gray-400 group-hover:text-gray-500 transition-colors">
        {{ isExpanded ? '收起' : '展开' }}
      </span>

      <!-- 箭头图标 -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 shrink-0 transition-transform duration-200"
        :class="{ 'rotate-180': isExpanded }"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <!-- 展开内容区 -->
    <div
      class="overflow-hidden transition-all duration-300 ease-in-out"
      :class="isExpanded ? 'max-h-[600px] opacity-100 mt-1.5' : 'max-h-0 opacity-0'"
    >
      <div
        class="px-3.5 py-3 sm:px-4 sm:py-3.5 bg-gray-50/70 border border-gray-200/50 rounded-xl text-xs sm:text-sm text-gray-500 leading-relaxed overflow-y-auto"
        :class="isExpanded ? 'max-h-[500px]' : ''"
      >
        <!-- 结构化段落展示 -->
        <div class="space-y-2.5">
          <p
            v-for="(para, idx) in paragraphs"
            :key="idx"
            class="whitespace-pre-wrap italic"
          >
            {{ para }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
