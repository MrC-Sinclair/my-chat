<script setup lang="ts">
/**
 * 登录/注册对话框（openspec/changes/add-user-auth）
 *
 * 布局适配（design.md UI 章节）：手机端底部全宽弹出（items-end），平板居中模态（sm:items-center）。
 * 交互：登录/注册 Tab 切换共享邮箱/密码输入；submitting 守卫防重复提交；
 * 错误统一 useToast 展示（后端 statusMessage 已脱敏，不泄露账号存在性细节）。
 * 成功后 applyUser 回写全局身份，会话列表刷新由父组件 watch(authUser) 触发。
 */
const props = defineProps<{
  open: boolean
  initialMode: 'login' | 'register'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const mode = ref<'login' | 'register'>('login')
watch(
  () => props.open,
  (open) => {
    if (open) {
      mode.value = props.initialMode
      email.value = ''
      password.value = ''
    }
  }
)

const email = ref('')
const password = ref('')
const submitting = ref(false)
const toast = useToast()
const { applyUser } = useAuth()

/** 游客注册场景的提示语（design.md 决策 3：就地升级，数据无感保留） */
const registerHint = computed(() =>
  mode.value === 'register' ? '注册后当前浏览器的会话与消息将保留到该账号下' : ''
)

async function submit() {
  if (submitting.value) return
  const trimmedEmail = email.value.trim()
  if (!trimmedEmail || !password.value) {
    toast.error('请输入邮箱和密码')
    return
  }
  submitting.value = true
  try {
    const url = mode.value === 'login' ? '/api/auth/login' : '/api/auth/register'
    const user = await $fetch<AuthUser>(url, {
      method: 'POST',
      body: { email: trimmedEmail, password: password.value }
    })
    applyUser(user)
    toast.success(mode.value === 'login' ? '登录成功' : '注册成功')
    emit('update:open', false)
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'data' in err
        ? String((err as { data?: { statusMessage?: string } }).data?.statusMessage || '')
        : ''
    toast.error(message || '操作失败，请重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      >
        <div
          class="absolute inset-0 bg-black/50"
          aria-hidden="true"
          @click="emit('update:open', false)"
        />
        <div
          class="relative w-full sm:max-w-sm bg-semi-bg-1 rounded-t-2xl sm:rounded-2xl p-5 shadow-semi-elevated"
          role="dialog"
          aria-label="登录或注册"
        >
          <!-- 手机端拖拽指示条 -->
          <div class="sm:hidden w-10 h-1 rounded-full bg-semi-border mx-auto mb-3" />

          <!-- 登录 / 注册 Tab -->
          <div class="flex gap-1 p-1 bg-semi-fill-1 rounded-xl mb-4">
            <button
              type="button"
              class="flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
              :class="mode === 'login' ? 'bg-semi-bg-1 text-semi-text-0 shadow-sm' : 'text-semi-text-3'"
              @click="mode = 'login'"
            >
              登录
            </button>
            <button
              type="button"
              class="flex-1 min-h-[44px] rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
              :class="mode === 'register' ? 'bg-semi-bg-1 text-semi-text-0 shadow-sm' : 'text-semi-text-3'"
              @click="mode = 'register'"
            >
              注册
            </button>
          </div>

          <form @submit.prevent="submit">
            <input
              v-model="email"
              type="email"
              required
              autocomplete="email"
              placeholder="邮箱"
              class="w-full min-h-[44px] px-3 py-2 mb-3 rounded-xl border border-semi-divider bg-semi-bg-0 text-semi-text-0 placeholder:text-semi-text-3 focus:outline-none focus:border-semi-primary transition-colors"
            />
            <input
              v-model="password"
              type="password"
              required
              :minlength="mode === 'register' ? 8 : 1"
              autocomplete="current-password"
              :placeholder="mode === 'register' ? '密码（至少 8 位）' : '密码'"
              class="w-full min-h-[44px] px-3 py-2 mb-2 rounded-xl border border-semi-divider bg-semi-bg-0 text-semi-text-0 placeholder:text-semi-text-3 focus:outline-none focus:border-semi-primary transition-colors"
            />
            <p v-if="registerHint" class="text-xs text-semi-text-3 mb-3">{{ registerHint }}</p>
            <button
              type="submit"
              :disabled="submitting"
              class="w-full min-h-[44px] rounded-xl bg-semi-primary text-white text-sm font-medium hover:bg-semi-primary-hover active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span v-if="submitting" class="inline-flex items-center gap-2">
                <svg
                  class="animate-spin w-4 h-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                处理中…
              </span>
              <span v-else>{{ mode === 'login' ? '登录' : '注册' }}</span>
            </button>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
