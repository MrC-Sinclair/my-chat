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
        class="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40"
        @click.self="cancel"
      >
        <Transition name="confirm-dialog" appear>
          <div
            v-if="visible"
            class="bg-white rounded-xl shadow-2xl p-6 min-w-[320px] max-w-[420px] mx-4"
          >
            <h3 class="text-lg font-semibold text-gray-800 mb-2">{{ title }}</h3>
            <p class="text-sm text-gray-600 mb-6 leading-relaxed">{{ message }}</p>
            <div class="flex justify-end gap-3">
              <button
                class="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 active:scale-95 transition-all"
                @click="cancel"
              >
                取消
              </button>
              <button
                class="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 active:scale-95 transition-all"
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
.confirm-overlay-enter-active { transition: opacity 0.2s ease; }
.confirm-overlay-leave-active { transition: opacity 0.15s ease; }
.confirm-overlay-enter-from,
.confirm-overlay-leave-to { opacity: 0; }

.confirm-dialog-enter-active { transition: all 0.2s ease-out; }
.confirm-dialog-leave-active { transition: all 0.15s ease-in; }
.confirm-dialog-enter-from { opacity: 0; transform: scale(0.95) translateY(8px); }
.confirm-dialog-leave-to { opacity: 0; transform: scale(0.95) translateY(8px); }
</style>
