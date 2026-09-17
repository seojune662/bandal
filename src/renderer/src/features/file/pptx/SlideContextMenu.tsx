import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function SlideContextMenu({ x, y, busy, onCopy, onClose }: {
  x: number; y: number; busy: boolean; onCopy: (includeInk: boolean) => void; onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - node.offsetWidth - 8))}px`
    node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - node.offsetHeight - 8))}px`
    node.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [x, y])
  useEffect(() => {
    const dismiss = (event: PointerEvent): void => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  return createPortal(<div ref={ref} role="menu" aria-label="슬라이드 메뉴" className="presentation-context-menu" onKeyDown={(event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const buttons = Array.from(ref.current?.querySelectorAll('button') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
    }
  }}>
    <button role="menuitem" type="button" disabled={busy} onClick={() => onCopy(true)}>이미지로 복사</button>
    <button role="menuitem" type="button" disabled={busy} onClick={() => onCopy(false)}>원본만 이미지로 복사</button>
  </div>, document.body)
}
