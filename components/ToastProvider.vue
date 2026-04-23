<script setup lang="ts">
export interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

const toasts = ref<ToastItem[]>([])
let nextId = 0

function show(message: string, type: ToastItem['type'] = 'info', duration = 3000) {
  const id = nextId++
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, duration)
}

function success(message: string) { show(message, 'success') }
function error(message: string) { show(message, 'error', 5000) }
function info(message: string) { show(message, 'info') }

provide('toast', { show, success, error, info })
</script>

<template>
  <slot />
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 min-w-[200px] max-w-[360px]"
          :class="{
            'bg-green-50 text-green-800 border border-green-200': toast.type === 'success',
            'bg-red-50 text-red-800 border border-red-200': toast.type === 'error',
            'bg-blue-50 text-blue-800 border border-blue-200': toast.type === 'info',
          }"
        >
          <span v-if="toast.type === 'success'">✓</span>
          <span v-else-if="toast.type === 'error'">✕</span>
          <span v-else>ℹ</span>
          <span>{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style>
.toast-enter-active {
  transition: all 0.25s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
