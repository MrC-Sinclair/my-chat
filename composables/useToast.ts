export function useToast() {
  const toast = inject<{
    show: (m: string, t?: 'success' | 'error' | 'info' | 'warning', d?: number) => void
    success: (m: string) => void
    error: (m: string) => void
    info: (m: string) => void
    warning: (m: string) => void
  }>('toast')
  if (!toast) throw new Error('useToast must be used within ToastProvider')
  return toast
}
