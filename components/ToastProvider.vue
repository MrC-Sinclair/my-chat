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

function success(message: string) {
  show(message, 'success')
}
function error(message: string) {
  show(message, 'error', 5000)
}
function info(message: string) {
  show(message, 'info')
}

provide('toast', { show, success, error, info })
</script>

<template>
  <slot />
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-semi-notification flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto px-4 py-3 rounded-lg shadow-semi-popover text-sm font-medium flex items-center gap-2 min-w-[200px] max-w-[360px]"
          :class="{
            'bg-semi-success-light text-semi-success border border-semi-success/30':
              toast.type === 'success',
            'bg-semi-danger-light text-semi-danger border border-semi-danger/30':
              toast.type === 'error',
            'bg-semi-info-light text-semi-info border border-semi-info/30': toast.type === 'info'
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
  transition: all theme('transitionDuration.semi-slow') ease-out;
}

.toast-leave-active {
  transition: all theme('transitionDuration.semi-normal') ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(calc(theme('spacing.semi-3xl') * -1));
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(calc(theme('spacing.semi-3xl') * -1));
}
</style>
