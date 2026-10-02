import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { SidebarAccountEntry } from '../features/account/SidebarAccountEntry'
import { HelpHub } from '../features/help/HelpHub'
import { TabKindIcon } from '../features/workspace/workspaceIcons'
import { Tooltip } from '../components/Tooltip'
import { Icon } from './icons'
import './global-navigation.css'

export function GlobalNavigation(): JSX.Element {
  const phase = useAuthStore((state) => state.auth.phase)
  const boardOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const settingsOpen = useUiStore((state) => state.isSettingsOpen)
  const graphOpen = useUiStore((state) => state.isLinkGraphOpen)
  const courseOpen = useUiStore((state) => state.courseRailOpen)
  const leftOpen = useUiStore((state) => state.leftRailOpen)
  const openCourses = (): void => {
    const ui = useUiStore.getState()
    if (ui.isSettingsOpen || ui.isBoardOverlayOpen || ui.isLinkGraphOpen) ui.showCourses()
    else ui.toggleCourseRail()
  }
  return (
    <nav className="global-navigation" aria-label="앱 메뉴" aria-hidden={!leftOpen}
      {...{ inert: !leftOpen ? '' : undefined }}>
      <Tooltip label="과목" placement="right">
        <button
          className="rail-nav__item"
          aria-label="과목"
          aria-expanded={courseOpen && !boardOpen && !settingsOpen && !graphOpen}
          aria-controls="course-rail"
          data-active={(!boardOpen && !settingsOpen && !graphOpen && courseOpen) || undefined}
          onClick={openCourses}
        >
          <Icon name="folder" />
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
      <HelpHub />
      <div className="global-navigation__bottom">
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
