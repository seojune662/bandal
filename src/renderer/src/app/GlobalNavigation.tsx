import { openCommunity } from './communityNavigation'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { SidebarAccountEntry } from '../features/account/SidebarAccountEntry'
import { HelpHub } from '../features/help/HelpHub'
import { TabKindIcon } from '../features/workspace/workspaceIcons'
import { captureLauncherContext } from '../features/launcher/launcherContext'
import { Tooltip } from '../components/Tooltip'
import { Icon } from './icons'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { RailUpdateButton } from '../features/updates/RailUpdateButton'
import './global-navigation.css'

export function GlobalNavigation(): JSX.Element {
  const phase = useAuthStore((state) => state.auth.phase)
  const boardOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const settingsOpen = useUiStore((state) => state.isSettingsOpen)
  const graphOpen = useUiStore((state) => state.isLinkGraphOpen)
  const courseOpen = useUiStore((state) => state.courseRailOpen)
  const leftPanel = useUiStore((state) => state.leftRailPanel)
  const leftOpen = useUiStore((state) => state.leftRailOpen)
  const surface = useWorkspaceStore((state) => state.surface)
  const openHome = (): void => {
    const ui = useUiStore.getState()
    const workspace = useWorkspaceStore.getState()
    ui.closeSettings(); ui.closeBoardOverlay(); ui.closeLinkGraph()
    if (workspace.surface === 'community' || workspace.surface === 'study-market') {
      if (workspace.activeWorkspace) workspace.showWorkspace(workspace.activeWorkspace)
      else workspace.showCourseWorkspace(null)
    }
    if (ui.leftRailPanel === 'plugins') ui.setHomeTab('courses')
    else if (ui.isSettingsOpen || ui.isBoardOverlayOpen || ui.isLinkGraphOpen || workspace.surface === 'community' || workspace.surface === 'study-market' || !ui.leftRailOpen || !ui.courseRailOpen) useUiStore.setState({ leftRailOpen: true, courseRailOpen: true })
    else ui.toggleCourseRail()
  }
  return (
    <nav className="global-navigation" aria-label="앱 메뉴" aria-hidden={!leftOpen}
      {...{ inert: !leftOpen ? '' : undefined }}>
      <Tooltip label="홈" placement="right">
        <button className="rail-nav__item" aria-label="홈" aria-expanded={courseOpen && leftPanel !== 'plugins' && !boardOpen && !settingsOpen && !graphOpen} aria-controls="course-rail" data-active={courseOpen && leftPanel !== 'plugins' && !boardOpen && !settingsOpen && !graphOpen && surface !== 'community' && surface !== 'study-market' || undefined} onClick={openHome}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
        </button>
      </Tooltip>
      <Tooltip label="학업 보드" placement="right">
        <button
          className="rail-nav__item"
          aria-label={boardOpen ? '학업 보드 닫기' : '학업 보드 열기'}
          aria-pressed={boardOpen}
          data-active={boardOpen || undefined}
          onClick={() => {
            useUiStore.getState().closeSettings()
            useUiStore.getState().toggleBoardOverlay()
          }}
        >
          <TabKindIcon kind="board" />
        </button>
      </Tooltip>
      <Tooltip label="더보기" placement="right">
        <button className="rail-nav__item" aria-label="더보기"
          aria-expanded={surface !== 'study-market' && surface !== 'community' && courseOpen && leftPanel === 'plugins' && !boardOpen && !settingsOpen && !graphOpen}
          aria-controls="plugins-panel"
          data-active={surface !== 'study-market' && surface !== 'community' && courseOpen && leftPanel === 'plugins' && !boardOpen && !settingsOpen && !graphOpen || undefined}
          onPointerDown={event => { if (event.button === 0) { event.preventDefault(); void captureLauncherContext() } }}
          onClick={event => {
            if (surface === 'study-market' || surface === 'community') {
              useWorkspaceStore.getState().showWorkspace(useWorkspaceStore.getState().activeWorkspace)
              useUiStore.setState({ courseRailOpen: false })
            }
            if (event.detail === 0) void captureLauncherContext()
            useUiStore.getState().togglePluginsPanel()
          }}>
          <span aria-hidden="true">···</span>
        </button>
      </Tooltip>
      <Tooltip label="커뮤니티" placement="right">
        <button className="rail-nav__item" aria-label="커뮤니티" aria-pressed={surface === 'community' && !boardOpen && !settingsOpen && !graphOpen}
          data-active={surface === 'community' && !boardOpen && !settingsOpen && !graphOpen || undefined} onClick={() => openCommunity()}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 1 1 18-4Z" /><path d="M8 10h8M8 14h5" /></svg>
        </button>
      </Tooltip>
      <HelpHub />
      <div className="global-navigation__bottom">
        <RailUpdateButton />
        {phase === 'signed-in' ? (
          <SidebarAccountEntry />
        ) : (
          <Tooltip label="계정" placement="right">
            <button
              className="rail-nav__item"
              aria-label="계정"
              onClick={() => useUiStore.getState().openSettings('account')}
            >
              <Icon name="user" />
            </button>
          </Tooltip>
        )}
        <Tooltip label="설정" placement="right">
          <button
            className="rail-nav__item"
            aria-label="설정"
            data-active={settingsOpen || undefined}
            onClick={() => useUiStore.getState().openSettings()}
          >
            <Icon name="settings" />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
