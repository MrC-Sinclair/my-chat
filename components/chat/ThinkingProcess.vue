<script setup lang="ts">
defineProps<{
  content: string
  isExpanded: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <div
    data-testid="thinking-process"
    class="mb-3 rounded-xl bg-semi-fill-0/70 border border-semi-divider/60 overflow-hidden"
  >
    <button
      class="w-full flex items-center gap-2 px-3 py-2 text-xs text-semi-text-2 hover:bg-semi-fill-0 transition-colors select-none"
      @click="emit('toggle')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3.5 h-3.5 text-semi-primary transition-transform duration-semi-normal shrink-0"
        :class="{ 'rotate-90': isExpanded }"
      >
        <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
        <path d="M12 12V2a10 10 0 0 1 8.66 14.34" />
      </svg>
      <span class="font-medium">思考过程</span>
      <span
        v-if="!isExpanded"
        class="text-semi-text-3 truncate flex-1 text-left"
      >
        {{ content.replace(/\n/g, ' ').slice(0, 60) }}{{ content.length > 60 ? '...' : '' }}
      </span>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3.5 h-3.5 ml-auto text-semi-text-3"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <div
      class="overflow-hidden transition-all duration-semi-normal ease-in-out"
      :class="isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'"
    >
      <div
        class="px-3 pb-3 pt-0.5 text-sm text-semi-text-2 whitespace-pre-wrap leading-relaxed border-t border-semi-divider/40"
      >
        {{ content }}
      </div>
    </div>
  </div>
</template>
