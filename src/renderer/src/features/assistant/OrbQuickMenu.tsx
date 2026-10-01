import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '../../lib/ipc'
import { updateComposerDraft } from '../chat/composerDraftStore'
export type QuickAction = 'region' | 'current' | 'screen' | 'file'
const actions: [QuickAction, string][] = [['region', '영역 선택해서 질문'], ['current', '선택한 내용 · 현재 자료 질문'], ['screen', '현재 화면 질문'], ['file', '파일 첨부해서 질문']]
export async function prepareQuickAction(action: QuickAction, id: string): Promise<boolean> {
  if (action === 'region' || action === 'screen') {
    const image = await invoke('assistant:capture', { region: action === 'region' })
    if (!image) return false
    updateComposerDraft(id, current => ({ images: [...current.images, image].slice(-5) }))
  } else if (action === 'file') {
    const { paths } = await invoke('chat:pickAttachments', {})
    if (!paths.length) return false
    updateComposerDraft(id, current => ({ files: [...current.files, ...paths.map(path => ({ path, name: path.split(/[\\/]/).pop() ?? path }))].slice(0, 20) }))
  }
  return true
}
export function useOrbMenu(anchor: RefObject<HTMLButtonElement>, onAction?: (action: QuickAction) => void, desktop = false) {
  const [hovered, setHovered] = useState(false), [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 8, top: 8 })
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const close = useCallback(() => { clearTimeout(timer.current); setOpen(false); setHovered(false) }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const enter = (): void => { clearTimeout(timer.current); setHovered(true); if (onAction) timer.current = setTimeout(() => {
    const rect = anchor.current?.getBoundingClientRect(); if (!rect) return
    setPosition({ left: Math.max(8, Math.min(rect.right - 244, window.innerWidth - 252)), top: desktop ? Math.min(rect.bottom + 4, window.innerHeight - 182) : rect.top >= 190 ? rect.top - 180 : rect.bottom + 6 }); setOpen(true)
  }, 450) }
  const leave = (): void => { clearTimeout(timer.current); timer.current = setTimeout(close, 220) }
  const menu = open ? createPortal(<div className="orb-quick-menu" role="menu" aria-label="AI 빠른 동작" style={position} onPointerEnter={() => { clearTimeout(timer.current); setHovered(true) }} onPointerLeave={leave} onFocus={() => clearTimeout(timer.current)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave() }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); anchor.current?.focus() } }}>
    {actions.map(([action, label], i) => <button type="button" role="menuitem" key={action} onClick={() => { close(); onAction?.(action) }}><span aria-hidden="true">{['⌗', '↗', '▣', '+'][i]}</span>{label}</button>)}
  </div>, document.body) : null
  return { hovered, open, close, enter, leave, menu }
}
