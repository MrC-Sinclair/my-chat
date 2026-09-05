/**
 * @file 全局身份状态 composable（openspec/changes/add-user-auth）
 *
 * 状态说明：
 *   - undefined = 尚未拉取（SSR 与客户端首帧一致渲染游客占位，避免水合不匹配）
 *   - null = 游客（DB 异常降级时中间件可能未创建成功）
 *   - AuthUser = 游客或正式用户
 *
 * 状态用 useState 共享：桌面/手机两份 SessionSidebar 实例与 AuthDialog 读写同一份。
 * fetchMe 只在 ai-chat.vue 挂载时调用一次。
 */
export interface AuthUser {
  id: string
  email: string | null
  isGuest: boolean
}

export function useAuth() {
  const user = useState<AuthUser | null | undefined>('auth-user', () => undefined)

  async function fetchMe() {
    try {
      const res = await $fetch<{ user: AuthUser | null }>('/api/auth/me')
      user.value = res.user ?? null
    } catch {
      // 拉取失败按游客占位（不影响本地浏览，下次操作会重新走中间件身份流程）
      user.value = null
    }
  }

  /** 登录/注册成功后由 AuthDialog 回写身份 */
  function applyUser(u: AuthUser) {
    user.value = u
  }

  /** 退出登录：清 Cookie 后重新拉取（中间件会签发新游客身份） */
  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // 忽略：Cookie 已无效时退出目的即达成
    }
    await fetchMe()
  }

  return { user, fetchMe, applyUser, logout }
}
