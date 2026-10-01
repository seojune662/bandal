import { useCallback, useEffect, useRef, useState } from 'react'
import { friendAttentionCount } from '../../../shared/group/friendAttention'
import { useAuthStore } from '../stores/authStore'
import { useFriendsStore } from '../stores/friendsStore'
import { useGroupsStore } from '../stores/groupsStore'
import { useUiStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { SidebarAccountEntry } from '../features/account/SidebarAccountEntry'
import { TogetherFooter } from '../features/group/TogetherFooter'
import { HelpHub } from '../features/help/HelpHub'
import { TabKindIcon } from '../features/workspace/workspaceIcons'
import { descriptorFor } from '../features/workspace/tabIdentity'
import { Tooltip } from '../components/Tooltip'
import { useDismissableMenu } from '../components/useDismissableMenu'
import { useViewportBounds } from '../lib/useViewportBounds'
import { Icon } from './icons'
import './global-navigation.css'

export function GlobalNavigation(): JSX.Element {
  const phase = useAuthStore((state) => state.auth.phase)
  const friends = useFriendsStore((state) => state.friends)
  const invites = useGroupsStore((state) => state.pendingInvites)
  const boardOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const settingsOpen = useUiStore((state) => state.isSettingsOpen)
  const [togetherOpen, setTogetherOpen] = useState(false)
  const together = useRef<HTMLDivElement>(null)
  const dismiss = useCallback(() => setTogetherOpen(false), [])
  useDismissableMenu(togetherOpen, together, dismiss)
  useViewportBounds(together)
  useEffect(() => {
    void useAuthStore.getState().init()
  }, [])
  useEffect(() => {
    if (phase !== 'signed-in') return
    void useFriendsStore.getState().init()
    void useGroupsStore.getState().init()
  }, [phase])
  const finishNavigation = useCallback(() => {
    const ui = useUiStore.getState()
    ui.closeSettings()
    ui.closeBoardOverlay()
    ui.closeLinkGraph()
    dismiss()
  }, [dismiss])
  const attention = friendAttentionCount(friends) + invites.length
  const openCourses = (): void => {
    const ui = useUiStore.getState()
    ui.closeSettings()
    ui.closeBoardOverlay()
    ui.closeLinkGraph()
    if (!ui.leftRailOpen) ui.toggleLeftRail()
  }
  return (
    <nav className="global-navigation" aria-label="앱 메뉴">
      <Tooltip label="과목" placement="right">
        <button
          className="rail-nav__item"
          aria-label="과목"
          data-active={(!boardOpen && !settingsOpen) || undefined}
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
      <div className="global-navigation__together">
        <Tooltip
          label={attention ? `함께하기 · 새 소식 ${attention}개` : '함께하기'}
          placement="right"
        >
          <button
            className="rail-nav__item"
            aria-label="함께하기"
            aria-haspopup="dialog"
            aria-expanded={togetherOpen}
            onClick={() => setTogetherOpen((open) => !open)}
          >
            <TabKindIcon kind="friends" />
            {attention > 0 && (
              <span className="rail-nav__badge">
                {attention > 99 ? '99+' : attention}
              </span>
            )}
          </button>
        </Tooltip>
        {togetherOpen && (
          <div
            ref={together}
            className="navigation-popover"
            role="dialog"
            aria-label="함께하기 메뉴"
          >
            <h2>함께하기</h2>
            {phase === 'signed-in' && (
              <button
                className="navigation-popover__action"
                onClick={() => {
                  finishNavigation()
                  useWorkspaceStore
                    .getState()
                    .openTab(descriptorFor('friends', {}))
                  dismiss()
                }}
              >
                <TabKindIcon kind="friends" />
                친구{attention > 0 && <span>{attention}</span>}
              </button>
            )}
            {phase === 'unconfigured' && (
              <p>이 환경에서는 함께하기를 사용할 수 없어요.</p>
            )}
            <TogetherFooter onNavigate={finishNavigation} />
          </div>
        )}
      </div>
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
