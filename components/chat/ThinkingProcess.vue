<script setup lang="ts">
defineProps<{
  content: string
}>()

const isVisible = ref(false)
</script>

<template>
  <div class="thinking-process mb-3">
    <button
      class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 active:scale-[0.98] border border-amber-200 transition-all w-full text-left"
      @click="isVisible = !isVisible"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
        :class="{ 'rotate-90': isVisible }"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      🧠 思考过程
      <span class="text-amber-500 ml-1">{{ isVisible ? '点击收起' : '点击展开' }}</span>
    </button>

    <div
      class="overflow-hidden transition-all duration-200 ease-in-out"
      :class="isVisible ? 'max-h-96 opacity-100 mt-2' : 'max-h-0 opacity-0'"
    >
      <div
        class="px-3 py-2 bg-amber-50/50 border border-amber-100 rounded-lg text-xs text-gray-600 whitespace-pre-wrap leading-relaxed overflow-y-auto"
        :class="isVisible ? 'max-h-60' : ''"
      >
        {{ content }}
      </div>
    </div>
  </div>
</template>
