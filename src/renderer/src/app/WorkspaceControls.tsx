import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Tooltip } from '../components/Tooltip'
import { useDismissableMenu } from '../components/useDismissableMenu'
import { useViewportBounds } from '../lib/useViewportBounds'
import { useUiStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { toggleWindowOverview } from '../features/workspace/windowOverviewController'
import { Icon } from './icons'

const chromeModes = [
  ['all', '모두 표시'],
  ['tabs-hidden', '탭 바만 숨기기'],
  ['all-hidden', '탭 바와 도구 모음 숨기기']
] as const

function TabsIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9h17M9 4.5V9M14.5 4.5V9" /></svg>
}
function WindowsIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="14" height="13" rx="2" /><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" /></svg>
}

/** This control group belongs to the OS window, never to a pane or sidebar. */
export function WorkspaceControls(): JSX.Element {
  const workspace = useWorkspaceStore(state => state.activeWorkspace)
  const mode = useWorkspaceStore(state => state.workspaceChromeMode)
  const overview = useWorkspaceStore(state => state.windowsOverviewOpen)
  const rightOpen = useUiStore(state => state.rightRailOpen)
  const settingsOpen = useUiStore(state => state.isSettingsOpen)
  const surface = useWorkspaceStore(state => state.surface)
  const rightVisible = rightOpen && !settingsOpen && (surface === 'course' || surface === 'learning-home')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismissableMenu(menuOpen, menuRef, closeMenu)
  useViewportBounds(menuRef)
  useEffect(() => setMenuOpen(false), [workspace])

  const menuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    if (!buttons.length) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  const toggleRight = (): void => {
    closeMenu()
    const ui = useUiStore.getState()
    const state = useWorkspaceStore.getState()
    const covered = ui.isSettingsOpen || ui.isBoardOverlayOpen || ui.isLinkGraphOpen ||
      (state.surface !== 'course' && state.surface !== 'learning-home')
    ui.closeSettings(); ui.closeBoardOverlay(); ui.closeLinkGraph()
    if (state.surface !== 'course' && state.surface !== 'learning-home') state.showWorkspace(state.activeWorkspace)
    if (covered) ui.setRightRailTab(ui.rightRailTab)
    else ui.toggleRightRail()
  }

  return <div className="workspace-controls" role="group" aria-label="작업 공간 보기">
    <Tooltip label="탭 바와 도구 모음 표시" placement="bottom"><button ref={triggerRef} type="button" className="titlebar-button" aria-label="탭 바와 도구 모음 표시" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="workspace-chrome-menu" disabled={workspace === null} onClick={() => setMenuOpen(value => !value)}><TabsIcon /></button></Tooltip>
    <Tooltip label={overview ? '윈도우 관리 닫기' : '윈도우 관리'} placement="bottom"><button type="button" className="titlebar-button" aria-label="윈도우 관리" data-workspace-control="windows" aria-pressed={overview} disabled={workspace === null} onClick={() => { closeMenu(); void toggleWindowOverview() }}><WindowsIcon /></button></Tooltip>
    <Tooltip label={rightVisible ? '오른쪽 사이드바 접기' : '오른쪽 사이드바 펼치기'} placement="bottom"><button type="button" className="titlebar-button" aria-label={rightVisible ? '오른쪽 사이드바 접기' : '오른쪽 사이드바 펼치기'} aria-expanded={rightVisible} aria-controls="right-sidebar" onClick={toggleRight}><Icon name="layoutRight" /></button></Tooltip>
    {menuOpen && <div ref={menuRef} id="workspace-chrome-menu" className="workspace-chrome-menu" role="menu" aria-label="탭 바와 도구 모음 표시" onKeyDown={menuKey}>
      {chromeModes.map(([value, label]) => <button key={value} type="button" role="menuitemradio" aria-checked={mode === value} onClick={() => { useWorkspaceStore.getState().setWorkspaceChromeMode(value); closeMenu(); triggerRef.current?.focus() }}><span>{label}</span><span aria-hidden="true">{mode === value ? '✓' : ''}</span></button>)}
    </div>}
  </div>
}
