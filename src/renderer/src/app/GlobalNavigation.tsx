import { Columns3, House, Settings, Sparkles } from 'lucide-react'
import { useUiStore } from '../stores/uiStore'
import { HelpHub } from '../features/help/HelpHub'
import { ProfileMenu } from '../features/account/ProfileMenu'
import { RailUpdateButton } from '../features/updates/RailUpdateButton'
import { Tooltip } from '../components/Tooltip'
import { useWorkspaceStore } from '../stores/workspaceStore'
import './global-navigation.css'

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const

/**
 * The skinny rail, translated from the iPad app's NativeWorkspaceRail:
 * 홈 · AI · 학업 보드, then 프로필 and 설정 at the foot. Home and AI open their
 * panel in the one slot beside the rail; pressing the open one folds it. The
 * open button becomes the panel's tab (NativeRailTab), drawn by the rail's CSS.
 */
export function GlobalNavigation(): JSX.Element {
  const boardOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const settingsOpen = useUiStore((state) => state.isSettingsOpen)
  const graphOpen = useUiStore((state) => state.isLinkGraphOpen)
  const courseOpen = useUiStore((state) => state.courseRailOpen)
  const aiOpen = useUiStore((state) => state.aiRailOpen)
  const leftPanel = useUiStore((state) => state.leftRailPanel)
  const leftOpen = useUiStore((state) => state.leftRailOpen)
  const surface = useWorkspaceStore((state) => state.surface)
  const overlayOpen = boardOpen || settingsOpen || graphOpen
  const railSurface = surface !== 'community' && surface !== 'study-market'
  const homeOpen = courseOpen && leftPanel !== 'plugins' && !overlayOpen && railSurface
  const assistantOpen = aiOpen && !overlayOpen && railSurface
  const tab = homeOpen ? 'home' : assistantOpen ? 'ai' : courseOpen && leftPanel === 'plugins' && !overlayOpen ? 'plugins' : undefined

  const leaveOverlays = (): boolean => {
    const ui = useUiStore.getState()
    const workspace = useWorkspaceStore.getState()
    const covered = ui.isSettingsOpen || ui.isBoardOverlayOpen || ui.isLinkGraphOpen || workspace.surface === 'community' || workspace.surface === 'study-market'
    ui.closeSettings(); ui.closeBoardOverlay(); ui.closeLinkGraph()
    if (workspace.surface === 'community' || workspace.surface === 'study-market') {
      if (workspace.activeWorkspace) workspace.showWorkspace(workspace.activeWorkspace)
      else workspace.showCourseWorkspace(null)
    }
    return covered
  }
  const openHome = (): void => {
    const ui = useUiStore.getState()
    const covered = leaveOverlays()
    if (ui.leftRailPanel === 'plugins') ui.setHomeTab('courses')
    else if (covered || !ui.leftRailOpen || !ui.courseRailOpen) useUiStore.setState({ leftRailOpen: true, courseRailOpen: true })
    else ui.toggleCourseRail()
  }
  const openAssistant = (): void => {
    const covered = leaveOverlays()
    const ui = useUiStore.getState()
    if (covered || !ui.aiRailOpen) ui.showAssistant()
    else ui.toggleAiRail()
  }

  return (
    <nav className="global-navigation" aria-label="앱 메뉴" aria-hidden={!leftOpen} data-tab={tab}
      {...{ inert: !leftOpen ? '' : undefined }}>
      <span className="global-navigation__tab" aria-hidden="true" />
      <Tooltip label="홈" placement="right">
        <button className="rail-nav__item" data-rail="home" aria-label="홈" aria-expanded={homeOpen} aria-controls="course-rail"
          data-open={homeOpen || undefined} onClick={openHome}>
          <House {...ICON} />
        </button>
      </Tooltip>
      <Tooltip label="AI" placement="right">
        <button className="rail-nav__item" data-rail="ai" aria-label="AI" aria-expanded={assistantOpen} aria-controls="ai-rail"
          data-open={assistantOpen || undefined} onClick={openAssistant}>
          <Sparkles {...ICON} />
        </button>
      </Tooltip>
      <Tooltip label="학업 보드" placement="right">
        <button
          className="rail-nav__item"
          data-rail="board"
          aria-label={boardOpen ? '학업 보드 닫기' : '학업 보드 열기'}
          aria-pressed={boardOpen}
          data-active={boardOpen || undefined}
          onClick={() => {
            useUiStore.getState().closeSettings()
            useUiStore.getState().toggleBoardOverlay()
          }}
        >
          <Columns3 {...ICON} />
        </button>
      </Tooltip>
      <div className="global-navigation__bottom">
        {/* Not a destination: only while an update waits, with its own save-and-retry recovery. */}
        <RailUpdateButton />
        <ProfileMenu />
        <Tooltip label="설정" placement="right">
          <button
            className="rail-nav__item"
            data-rail="settings"
            aria-label="설정"
            data-active={settingsOpen || undefined}
            onClick={() => {
              const ui = useUiStore.getState()
              if (ui.isSettingsOpen) ui.closeSettings()
              else ui.openSettings()
            }}
          >
            <Settings {...ICON} />
          </button>
        </Tooltip>
      </div>
      {/* Help keeps its dialogs and shortcut listeners; the profile menu opens its menu. */}
      <HelpHub />
    </nav>
  )
}
