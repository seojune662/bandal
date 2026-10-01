import { useEffect, type RefObject } from 'react'

/** Consistent keyboard entry, dismissal and focus return for floating menus. */
export function useDismissableMenu(
  active: boolean,
  ref: RefObject<HTMLElement>,
  dismiss: () => void
): void {
  useEffect(() => {
    if (!active) return
    const trigger = document.activeElement
    const frame = requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus()
    )
    const pointer = (event: PointerEvent): void => {
      const target = event.target as Node
      if (
        !ref.current?.contains(target) &&
        !(trigger instanceof HTMLElement && trigger.contains(target))
      )
        dismiss()
    }
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        dismiss()
        if (trigger instanceof HTMLElement && trigger.isConnected)
          trigger.focus()
      }
    }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('keydown', keyboard)
    window.addEventListener('blur', dismiss)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', pointer)
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('blur', dismiss)
    }
  }, [active, ref, dismiss])
}
