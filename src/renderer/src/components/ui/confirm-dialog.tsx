import { useCallback, useRef, useState, type ReactNode } from 'react'

import { useT } from '../../i18n'
import { Button } from './button'
import { ConfirmDialogContext, type ConfirmOptions } from './confirm-dialog-context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './dialog'

interface PendingPrompt {
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

/** Promise-based confirm/alert dialog. Prompts queue; one shows at a time. */
export function ConfirmDialogProvider({ children }: { children: ReactNode }): JSX.Element {
  const t = useT()
  // Side effects stay out of setState updaters: StrictMode runs those twice.
  const queue = useRef<PendingPrompt[]>([])
  const showing = useRef<PendingPrompt | null>(null)
  const [current, setCurrent] = useState<PendingPrompt | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      const prompt = { options, resolve }
      if (showing.current !== null) {
        queue.current.push(prompt)
        return
      }
      showing.current = prompt
      setCurrent(prompt)
    })
  }, [])

  const settle = useCallback((confirmed: boolean) => {
    const prompt = showing.current
    if (prompt === null) return
    prompt.resolve(prompt.options.acknowledgeOnly === true ? true : confirmed)
    const next = queue.current.shift() ?? null
    showing.current = next
    setCurrent(next)
  }, [])

  const options = current?.options
  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <Dialog open={current !== null} onOpenChange={open => { if (!open) settle(false) }}>
        {options !== undefined && (
          <DialogContent size="compact" showCloseButton={false} closeLabel={t('common.close')}>
            <DialogHeader className="pr-0">
              <DialogTitle>{options.title}</DialogTitle>
              {options.description !== undefined && (
                <DialogDescription className="whitespace-pre-line">{options.description}</DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              {options.acknowledgeOnly !== true && (
                <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                  {options.cancelLabel ?? t('common.cancel')}
                </Button>
              )}
              <Button
                size="sm"
                variant={options.confirmVariant === 'destructive' ? 'destructive' : 'default'}
                autoFocus
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? t('common.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmDialogContext.Provider>
  )
}
