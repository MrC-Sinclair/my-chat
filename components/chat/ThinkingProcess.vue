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
      class="group flex items-center gap-2 w-full text-left px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl bg-semi-fill-0 hover:bg-semi-fill-1 active:scale-[0.98] transition-all duration-200 border border-semi-border/60"
      @click="emit('toggle')"
    >
      <!-- 脉冲动画点 -->
      <span class="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5">
        <span
          class="animate-ping absolute inline-flex h-full w-full rounded-full bg-semi-primary opacity-75"
        />
        <span class="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-semi-primary" />
      </span>

      <!-- 标题 -->
      <span class="text-xs sm:text-sm font-medium text-semi-text-2 flex-1"> 已深度思考 </span>

      <!-- 展开/收起指示 -->
      <span
        class="text-semi-micro sm:text-semi-caption text-semi-text-3 group-hover:text-semi-text-2 transition-colors"
      >
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
        class="w-3.5 h-3.5 sm:w-4 sm:h-4 text-semi-text-3 shrink-0 transition-transform duration-200"
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
        class="px-3.5 py-3 sm:px-4 sm:py-3.5 bg-semi-fill-0/70 border border-semi-border/50 rounded-xl text-xs sm:text-sm text-semi-text-3 leading-relaxed overflow-y-auto"
        :class="isExpanded ? 'max-h-[500px]' : ''"
      >
        <!-- 结构化段落展示 -->
        <div class="space-y-2.5">
          <p v-for="(para, idx) in paragraphs" :key="idx" class="whitespace-pre-wrap italic">
            {{ para }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
