import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDismissableMenu } from '../../components/useDismissableMenu'
import { useViewportBounds } from '../../lib/useViewportBounds'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'

export function ProjectGroupMenu({ name, onCreate, onRename, onDelete }: {
  name: string
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
}): JSX.Element {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setPosition(null), [])
  useDismissableMenu(Boolean(position), menu, close)
  useViewportBounds(menu)
  useEffect(() => position ? acquirePointerPassthrough() : undefined, [position])
  return <>
    <button ref={trigger} type="button" className="bare-icon-button" aria-label={`${name} 그룹 메뉴`} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
      const rect = trigger.current?.getBoundingClientRect()
      setPosition(position || !rect ? null : { left: Math.max(8, rect.right - 160), top: rect.bottom + 4 })
    }}>···</button>
    {position && createPortal(<div ref={menu} role="menu" aria-label={`${name} 그룹 관리`} className="project-menu project-menu--portal" style={position} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }}>
      <button type="button" role="menuitem" onClick={() => { close(); onCreate() }}>프로젝트 추가</button>
      <button type="button" role="menuitem" onClick={() => { close(); onRename() }}>이름 변경</button>
      <button type="button" role="menuitem" onClick={() => { close(); onDelete() }}>그룹 삭제</button>
    </div>, document.body)}
  </>
}
