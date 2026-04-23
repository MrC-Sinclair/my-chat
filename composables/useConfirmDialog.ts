export function useConfirmDialog() {
  const dialog = inject<{ open: (opts: { title?: string; message: string }) => Promise<boolean> }>('confirmDialog')
  if (!dialog) throw new Error('useConfirmDialog must be used within ConfirmDialogProvider')
  return dialog
}
