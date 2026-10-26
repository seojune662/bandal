import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { loadWindowPreview } from './windowPreview'
import type { WorkspaceWindowInfo } from '../../../../shared/workspaceWindows'
import './workspace-windows.css'

function WindowCard({ item, index, count, scope }: { item: WorkspaceWindowInfo; index: number; count: number; scope: string }): JSX.Element {
  const active = useWorkspaceStore(state => state.activeWindowId === item.id)
  const [image, setImage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    let alive = true
    void loadWindowPreview(scope, item.id).then(value => { if (alive) setImage(value) }).catch(() => {})
    return () => { alive = false }
  }, [scope, item.id])
  useEffect(() => setName(item.name), [item.name])
  const rename = (): void => {
    const value = name.trim()
    if (value) useWorkspaceStore.getState().renameWindow(item.id, value)
    else setName(item.name)
    setEditing(false)
  }
  const move = (offset: number): void => {
    const store = useWorkspaceStore.getState()
    const ids = store.windows.map(window => window.id)
    const target = index + offset
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    store.reorderWindows(ids)
  }
  return <article className="workspace-window-card" data-active={active || undefined} data-window-id={item.id}>
    <button className="workspace-window-card__preview" type="button" aria-label={`${item.name} 열기`}
      aria-current={active ? 'true' : undefined} disabled={closing} onClick={() => useWorkspaceStore.getState().selectWindow(item.id)}>
      {image ? <img src={image} alt={`${item.name} 마지막 화면`} draggable={false} /> :
        <span className="workspace-window-card__empty"><Icon name="layoutLeft" /><span>아직 미리보기 없음</span></span>}
      {active && <span className="workspace-window-card__current">현재 윈도우</span>}
    </button>
    <div className="workspace-window-card__footer">
      {editing ? <input className="workspace-window-card__name-input" aria-label="윈도우 이름" value={name} maxLength={80} autoFocus
        onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)} onBlur={rename}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); rename() }; if (event.key === 'Escape') { event.stopPropagation(); setName(item.name); setEditing(false) } }} /> :
        <button type="button" className="workspace-window-card__name" title="이름 변경" aria-label={`${item.name} 이름 변경`} onClick={() => setEditing(true)}>{item.name}</button>}
      <div className="workspace-window-card__actions">
        <button type="button" aria-label={`${item.name} 앞으로 이동`} title="앞으로 이동" disabled={index === 0 || closing} onClick={() => move(-1)}><Icon name="chevronLeft" /></button>
        <button type="button" aria-label={`${item.name} 뒤로 이동`} title="뒤로 이동" disabled={index === count - 1 || closing} onClick={() => move(1)}><Icon name="chevronRight" /></button>
        <button type="button" aria-label={`${item.name} 닫기`} title={count === 1 ? '윈도우 하나는 유지해야 합니다' : '윈도우 닫기'} disabled={count === 1 || closing}
          onClick={async () => {
            setClosing(true)
            try {
              if (!await useWorkspaceStore.getState().closeWindow(item.id)) showToast('저장 상태를 확인한 뒤 윈도우를 다시 닫아 주세요.', 'danger')
            } catch (error) { showToast(error instanceof Error ? error.message : '윈도우를 닫지 못했어요.', 'danger') }
            finally { setClosing(false) }
          }}><Icon name="x" /></button>
      </div>
    </div>
  </article>
}

export function WorkspaceWindowsOverview(): JSX.Element {
  const windows = useWorkspaceStore(state => state.windows)
  const scope = useWorkspaceStore(state => state.activeWorkspaceKey)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      useWorkspaceStore.getState().setWindowsOverviewOpen(false)
      document.querySelector<HTMLButtonElement>('[data-workspace-control="windows"]')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return <section className="workspace-windows-overview" aria-labelledby="workspace-windows-heading">
    <header className="workspace-windows-overview__heading"><div>
      <h1 id="workspace-windows-heading" ref={heading} tabIndex={-1}>윈도우</h1>
      <p>작업 화면을 나누고, 하던 곳에서 이어가세요.</p>
    </div><button type="button" className="bare-icon-button" aria-label="윈도우 관리 닫기" onClick={() => useWorkspaceStore.getState().setWindowsOverviewOpen(false)}><Icon name="x" /></button></header>
    <div className="workspace-windows-grid">
      {scope && windows.map((item, index) => <WindowCard key={item.id} item={item} index={index} count={windows.length} scope={scope} />)}
      <button type="button" className="workspace-window-add" onClick={() => useWorkspaceStore.getState().createWindow()}><span><Icon name="plus" /></span>윈도우 추가</button>
    </div>
  </section>
}
