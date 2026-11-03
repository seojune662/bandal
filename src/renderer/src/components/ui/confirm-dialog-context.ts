import { createContext, useContext } from 'react'

// Context lives in its own module so Fast Refresh keeps its identity
// (same split as Orca's confirmation-dialog-context.ts).

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'destructive'
  /** A notice, not a question: only the confirm button shows; resolves true. */
  acknowledgeOnly?: boolean
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmDialogContext = createContext<ConfirmFn | null>(null)

/** Replacement for window.confirm/alert: `if (await confirm({...})) …`. */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmDialogContext)
  if (confirm === null) throw new Error('useConfirm must be used inside ConfirmDialogProvider')
  return confirm
}
