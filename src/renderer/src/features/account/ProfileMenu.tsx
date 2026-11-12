import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { BookOpen, CircleHelp, LayoutGrid, LogIn, LogOut, MessagesSquare, Settings, UserRound } from 'lucide-react'
import { Tooltip } from '../../components/Tooltip'
import { useDismissableMenu } from '../../components/useDismissableMenu'
import { useViewportBounds } from '../../lib/useViewportBounds'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { openCommunity } from '../../app/communityNavigation'
import { captureLauncherContext } from '../launcher/launcherContext'
import { openHelpMenu } from '../help/HelpHub'
import { useTourStore } from '../onboarding/tour/tourStore'
import { AccountAvatar } from './AccountAvatar'
import './account.css'

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const

/**
 * 프로필: the rail's account button and its glass menu (iPad
 * NativeAccountRailButton). It also carries what left the rail — help,
 * community and plugins — so the rail keeps five items.
 */
export function ProfileMenu(): JSX.Element {
  const auth = useAuthStore((state) => state.auth)
  const signOut = useAuthStore((state) => state.signOut)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingRef = useRef(false)
  const requestGeneration = useRef(0)
  const popoverId = useId()
  const profile = auth.phase === 'signed-in' ? auth.profile : null
  const leftOpen = useUiStore(state => state.leftRailOpen)
  const closeMenu = useCallback(() => setOpen(false), [])
  useDismissableMenu(open, menuRef, closeMenu)
  useViewportBounds(menuRef)
  useEffect(() => { if (!leftOpen) setOpen(false) }, [leftOpen])
  useEffect(() => {
    setOpen(false); setError(null); pendingRef.current = false; setPending(false)
    return () => { requestGeneration.current += 1 }
  }, [profile?.id])
  const focusIndex = useRef<'first' | 'last' | null>(null)
  useEffect(() => {
    if (!open || focusIndex.current === null) return
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    ;(focusIndex.current === 'last' ? items?.[items.length - 1] : items?.[0])?.focus()
    focusIndex.current = null
  }, [open])

  const email = auth.phase === 'signed-in' ? auth.email : null
  const displayName = profile ? profile.nickname?.trim() || email?.split('@')[0] || '내 계정' : '로그인'
  const run = (action: () => void) => (): void => { closeMenu(); action() }
  const openSettings = (target?: 'account'): void => useUiStore.getState().openSettings(target)
  const openPlugins = (): void => {
    const workspace = useWorkspaceStore.getState()
    if (workspace.surface === 'study-market' || workspace.surface === 'community') {
      workspace.showWorkspace(workspace.activeWorkspace)
      useUiStore.setState({ courseRailOpen: false })
    }
    void captureLauncherContext()
    useUiStore.getState().togglePluginsPanel()
  }

  const handleMenuKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') { closeMenu(); triggerRef.current?.focus(); return }
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
    else return
    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
  }

  const handleSignOut = async (): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    const generation = requestGeneration.current
    setPending(true); setError(null)
    try {
      await signOut()
      if (generation === requestGeneration.current) closeMenu()
    } catch {
      if (generation === requestGeneration.current) setError('로그아웃하지 못했어요. 다시 시도해 주세요.')
    } finally {
      if (generation === requestGeneration.current) { pendingRef.current = false; setPending(false) }
    }
  }

  const item = (key: string, icon: JSX.Element, label: string, onClick: () => void, extra?: { trailing?: string; disabled?: boolean; className?: string }): JSX.Element => (
    <button key={key} type="button" role="menuitem" tabIndex={-1} className={`profile-menu__item${extra?.className ? ` ${extra.className}` : ''}`}
      aria-disabled={extra?.disabled || undefined} onClick={() => { if (!extra?.disabled) onClick() }}>
      {icon}<span>{label}</span>{extra?.trailing && <span className="profile-menu__trailing" aria-hidden="true">{extra.trailing}</span>}
    </button>
  )

  return (
    <div className="profile-menu">
      <Tooltip label={profile ? displayName : '프로필'} placement="right">
        <button
          ref={triggerRef}
          type="button"
          className="rail-nav__item profile-menu__trigger"
          data-rail="profile"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          aria-label={profile ? `프로필: ${displayName}` : '프로필'}
          data-active={open || undefined}
          onClick={() => { triggerRef.current?.focus(); focusIndex.current = 'first'; setOpen(current => !current) }}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault(); event.stopPropagation()
            focusIndex.current = event.key === 'ArrowDown' ? 'first' : 'last'
            if (open) { const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'); (event.key === 'ArrowDown' ? items?.[0] : items?.[items.length - 1])?.focus() }
            else { triggerRef.current?.focus(); setOpen(true) }
          }}
        >
          {profile
            ? <AccountAvatar avatarUrl={auth.phase === 'signed-in' ? auth.avatarUrl : null} nickname={displayName} size="sm" />
            : <span className="profile-menu__disc" aria-hidden="true"><UserRound size={15} strokeWidth={1.9} /></span>}
        </button>
      </Tooltip>

      {open && (
        <div id={popoverId} ref={menuRef} className="profile-menu__popover glass-popover" role="menu" aria-label="프로필"
          aria-busy={pending || undefined} onKeyDown={handleMenuKeys}>
          <div className="profile-menu__header">
            {email !== null && <span className="profile-menu__email" title={email}>{email}</span>}
            <strong title={displayName}>{profile ? displayName : '반달에 로그인하세요'}</strong>
            {!profile && <span className="profile-menu__email">동기화와 AI를 쓰려면 로그인이 필요해요</span>}
          </div>
          {profile
            ? item('account', <UserRound {...ICON} />, '계정', run(() => openSettings('account')))
            : item('signin', <LogIn {...ICON} />, '로그인', run(() => openSettings('account')))}
          {item('settings', <Settings {...ICON} />, '설정', run(() => openSettings()))}
          <div className="profile-menu__divider" role="separator" />
          {item('plugins', <LayoutGrid {...ICON} />, '플러그인', run(openPlugins))}
          {item('community', <MessagesSquare {...ICON} />, '커뮤니티', run(() => openCommunity()))}
          {item('help', <CircleHelp {...ICON} />, '도움말', () => {
            const rect = menuRef.current?.getBoundingClientRect()
            closeMenu()
            openHelpMenu({ left: (rect?.right ?? 320) + 10, top: Math.max(8, (rect?.bottom ?? 400) - 360) })
          }, { trailing: '›' })}
          {item('guide', <BookOpen {...ICON} />, '둘러보기', run(() => { void useTourStore.getState().start() }))}
          {profile && <>
            <div className="profile-menu__divider" role="separator" />
            {item('signout', <LogOut {...ICON} />, pending ? '로그아웃 중…' : '로그아웃', () => void handleSignOut(), { disabled: pending, className: 'profile-menu__item--danger' })}
          </>}
          {error !== null && <p className="profile-menu__error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
