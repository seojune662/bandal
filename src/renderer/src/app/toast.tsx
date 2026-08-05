/**
 * [M5] Minimal app-level toast: a zustand queue plus a fixed host rendered
 * once in AppShell. Call `showToast(message)` from anywhere in the renderer.
 * Toasts auto-dismiss (danger toasts stay a bit longer) and can be clicked
 * away.
 */

import { create } from 'zustand'

const TOAST_DURATION_MS = 3200
const TOAST_DANGER_DURATION_MS = 6400

export type ToastTone = 'info' | 'danger'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, tone: ToastTone) => void
  dismiss: (id: number) => void
}

let toastSeq = 0

const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, tone) => {
    toastSeq += 1
    const id = toastSeq
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
    window.setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((toast) => toast.id !== id)
      }))
    }, tone === 'danger' ? TOAST_DANGER_DURATION_MS : TOAST_DURATION_MS)
  },
  dismiss: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
  }
}))

/** Imperative entry point for features (imports, background failures, …). */
export function showToast(message: string, tone: ToastTone = 'info'): void {
  useToastStore.getState().show(message, tone)
}

export function ToastHost(): JSX.Element | null {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  if (toasts.length === 0) return null

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className="toast"
          data-tone={toast.tone}
          onClick={() => dismiss(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  )
}
