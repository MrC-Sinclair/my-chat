<script setup lang="ts">
const visible = ref(false)
const title = ref('')
const message = ref('')
let _resolve: (value: boolean) => void = () => {}

function open(opts: { title?: string; message: string }): Promise<boolean> {
  title.value = opts.title || '确认'
  message.value = opts.message
  visible.value = true
  return new Promise((resolve) => {
    _resolve = resolve
  })
}

function confirm() {
  visible.value = false
  _resolve(true)
}

function cancel() {
  visible.value = false
  _resolve(false)
}

provide('confirmDialog', { open })
</script>

<template>
  <slot />
  <Teleport to="body">
    <Transition name="confirm-overlay">
      <div
        v-if="visible"
        class="fixed inset-0 z-semi-modal flex items-center justify-center bg-semi-overlay-subtle"
        @click.self="cancel"
      >
        <Transition name="confirm-dialog" appear>
          <div
            v-if="visible"
            class="bg-semi-bg-0 rounded-xl shadow-semi-popover p-6 min-w-[320px] max-w-[420px] mx-4"
          >
            <h3 class="text-lg font-semibold text-semi-text-0 mb-2">{{ title }}</h3>
            <p class="text-sm text-semi-text-2 mb-6 leading-relaxed">{{ message }}</p>
            <div class="flex justify-end gap-3">
              <button
                class="px-4 py-2 text-sm font-medium text-semi-text-2 bg-semi-fill-1 rounded-lg hover:bg-semi-fill-2 active:scale-95 transition-all"
                @click="cancel"
              >
                取消
              </button>
              <button
                class="px-4 py-2 text-sm font-medium text-white bg-semi-danger rounded-lg hover:bg-semi-danger active:scale-95 transition-all"
                @click="confirm"
              >
                确认删除
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.confirm-overlay-enter-active {
  transition: opacity theme('transitionDuration.semi-normal') ease;
}

.confirm-overlay-leave-active {
  transition: opacity theme('transitionDuration.semi-fast') ease;
}

.confirm-overlay-enter-from,
.confirm-overlay-leave-to {
  opacity: 0;
}

.confirm-dialog-enter-active {
  transition: all theme('transitionDuration.semi-normal') ease-out;
}

.confirm-dialog-leave-active {
  transition: all theme('transitionDuration.semi-fast') ease-in;
}

.confirm-dialog-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(theme('spacing.semi-sm'));
}

.confirm-dialog-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(theme('spacing.semi-sm'));
}
</style>
