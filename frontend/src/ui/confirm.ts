// Replacement for native confirm(): `if (!(await confirmDialog({ message: tr('…') }))) return`. Pass already translated text.
// Rendered by ConfirmDialog.svelte, mounted once in App.svelte. A newer request cancels (resolves false) a pending one.
import { writable } from 'svelte/store'
export type ConfirmRequest = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
export type PendingConfirm = ConfirmRequest & { settle: (accepted: boolean) => void }
export const pendingConfirm = writable<PendingConfirm | null>(null)
let current: PendingConfirm | null = null
export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  current?.settle(false)
  return new Promise(resolve => {
    const entry: PendingConfirm = { ...request, settle: accepted => {
      if (current !== entry) return
      current = null; pendingConfirm.set(null); resolve(accepted)
    } }
    current = entry; pendingConfirm.set(entry)
  })
}
