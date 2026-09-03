import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHANGELOG_URL, DOCS_URL } from '../../../../shared/appLinks'
import { formatChord, parseChord, SHORTCUT_SPECS } from '../../../../shared/keymap'
import { Icon } from '../../app/icons'
import {
  ADD_COURSE_SHORTCUT_EVENT,
  IMPORT_MATERIALS_SHORTCUT_EVENT,
  SHORTCUT_HELP_EVENT
} from '../../app/shortcuts'
import { showToast } from '../../app/toast'
import { Tooltip } from '../../components/Tooltip'
import { useLocale, useT } from '../../i18n'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { useUpdateStore } from '../../stores/updateStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { useTourStore } from '../onboarding/tour/tourStore'
import { FeedbackDialog, OPEN_FEEDBACK_EVENT } from './FeedbackDialog'
import { MilestonesOverlay } from './MilestonesOverlay'
import { ProgressRing } from './ProgressRing'
import { ShortcutHelpOverlay } from './ShortcutHelpOverlay'
import { useMilestones, type MilestoneId } from './milestonesStore'
import './help.css'

interface MenuPosition {
  left: number
  top: number
}

type FocusTarget = 'favorites-section' | 'assistant-orb' | 'together-footer'

export const HELP_FOCUS_TARGET_EVENT = 'bandal:help-focus-target'

let helpEventBridgeInstalled = false
const pendingEventReplays = new Set<string>()

/**
 * CourseSidebar is unmounted while the left rail is collapsed. Re-open the
 * rail and replay global help events after React has mounted their receiver.
 */
export function installCollapsedRailHelpBridge(): void {
  if (helpEventBridgeInstalled || typeof window === 'undefined') return
  helpEventBridgeInstalled = true
  for (const eventName of [SHORTCUT_HELP_EVENT, OPEN_FEEDBACK_EVENT]) {
    window.addEventListener(eventName, () => {
      const ui = useUiStore.getState()
      if (ui.leftRailOpen || pendingEventReplays.has(eventName)) return
      pendingEventReplays.add(eventName)
      ui.toggleLeftRail()
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          pendingEventReplays.delete(eventName)
          window.dispatchEvent(new CustomEvent(eventName))
        })
      })
    })
  }
}

installCollapsedRailHelpBridge()

export function milestoneDestination(
  id: MilestoneId
):
  | 'settings-university'
  | 'settings-ai'
  | 'course'
  | 'materials'
  | 'tour'
  | FocusTarget
  | 'pip' {
  switch (id) {
    case 'university':
      return 'settings-university'
    case 'course':
      return 'course'
    case 'materials':
      return 'materials'
    case 'agent':
      return 'settings-ai'
    case 'tutorial':
      return 'tour'
    case 'favorite':
      return 'favorites-section'
    case 'question':
      return 'assistant-orb'
    case 'group':
      return 'together-footer'
    case 'pip':
      return 'pip'
  }
}

function focusTarget(target: FocusTarget): void {
  const selector =
    target === 'together-footer'
      ? '.together-footer'
      : `[data-tour="${target}"]`
  const reveal = (): void => {
    const element = document.querySelector<HTMLElement>(selector)
    if (element === null) return
    element.scrollIntoView({ block: 'nearest' })
    if (!element.hasAttribute('tabindex')) element.tabIndex = -1
    element.focus()
  }

  if (target === 'favorites-section') {
    const toggle = document.querySelector<HTMLButtonElement>(
      '.course-row[data-selected="true"] .course-row__toggle[aria-expanded="false"]'
    )
    toggle?.click()
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(reveal))
}

function defaultShortcutLabel(platform: string): string {
  const spec = SHORTCUT_SPECS.find((candidate) => candidate.id === 'shortcut-help')
  const parsed = spec?.defaultChord === null || spec?.defaultChord === undefined
    ? null
    : parseChord(spec.defaultChord)
  return parsed === null ? '—' : formatChord(parsed, platform)
}

export function HelpHub(): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const progress = useMilestones((state) => state.progress)
  const refreshMilestones = useMilestones((state) => state.refresh)
  const updateStatus = useUpdateStore((state) => state.status)
  const initUpdates = useUpdateStore((state) => state.init)
  const checkUpdates = useUpdateStore((state) => state.check)
  const [menu, setMenu] = useState<MenuPosition | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [milestonesOpen, setMilestonesOpen] = useState(false)

  useEffect(() => {
    initUpdates()
  }, [initUpdates])

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (menu === null) return
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    })
    const onPointerDown = (event: PointerEvent): void => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        closeMenu()
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', closeMenu)
    }
  }, [closeMenu, menu])

  useEffect(() => {
    const openShortcuts = (): void => {
      closeMenu()
      setMilestonesOpen(false)
      setShortcutsOpen(true)
    }
    const handleFocusTarget = (event: Event): void => {
      const detail = (event as CustomEvent<{ target: FocusTarget }>).detail
      focusTarget(detail.target)
    }
    window.addEventListener(SHORTCUT_HELP_EVENT, openShortcuts)
    window.addEventListener(HELP_FOCUS_TARGET_EVENT, handleFocusTarget)
    return () => {
      window.removeEventListener(SHORTCUT_HELP_EVENT, openShortcuts)
      window.removeEventListener(HELP_FOCUS_TARGET_EVENT, handleFocusTarget)
    }
  }, [closeMenu])

  const openHelpPage = (url: string): void => {
    closeMenu()
    const target = new URL(url)
    if (locale === 'ko-KR') target.pathname = `/ko${target.pathname}`
    useWorkspaceStore.getState().openTab(
      descriptorFor('browser', {
        tabId: crypto.randomUUID(),
        initialUrl: target.toString()
      })
    )
  }

  const runMilestoneAction = (id: MilestoneId): void => {
    setMilestonesOpen(false)
    const destination = milestoneDestination(id)
    if (
      destination === 'settings-university' ||
      destination === 'settings-ai'
    ) {
      useUiStore.getState().openSettings()
      const categoryLabel = t(
        destination === 'settings-university'
          ? 'settings.category.university.label'
          : 'settings.category.ai.label'
      )
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const category = [
            ...document.querySelectorAll<HTMLButtonElement>('.settings-nav__item')
          ].find((button) => button.textContent?.trim() === categoryLabel)
          category?.click()
        })
      })
      return
    }
    if (destination === 'course') {
      window.dispatchEvent(new CustomEvent(ADD_COURSE_SHORTCUT_EVENT))
      return
    }
    if (destination === 'materials') {
      const ui = useUiStore.getState()
      if (!ui.rightRailOpen) ui.toggleRightRail()
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(IMPORT_MATERIALS_SHORTCUT_EVENT))
      })
      return
    }
    if (destination === 'tour') {
      void useTourStore.getState().start()
      return
    }
    if (destination === 'pip') {
      document
        .querySelector<HTMLButtonElement>('.file-video__pip:not(:disabled)')
        ?.click()
      return
    }
    window.dispatchEvent(
      new CustomEvent(HELP_FOCUS_TARGET_EVENT, {
        detail: { target: destination }
      })
    )
  }

  const shortcutLabel = useMemo(
    () => defaultShortcutLabel(window.bandal?.platform ?? 'darwin'),
    []
  )
  const checkingUpdate = updateStatus?.phase === 'checking'

  return (
    <>
      <Tooltip label={t('help.menu.button')} placement="top">
        <button
          ref={triggerRef}
          type="button"
          className="rail-nav__item"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-label={t('help.menu.button')}
          onClick={(event) => {
            if (menu !== null) {
              closeMenu()
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({ left: rect.left, top: rect.top })
            void refreshMilestones(selectedCourseId)
          }}
        >
          <Icon name="help" />
        </button>
      </Tooltip>

      {menu !== null && (
        <div
          ref={menuRef}
          className="context-menu help-menu"
          role="menu"
          aria-label={t('help.menu.label')}
          style={{ left: menu.left, top: menu.top }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu()
              setShortcutsOpen(true)
            }}
          >
            <span>{t('help.menu.shortcuts')}</span>
            <kbd className="help-menu__accessory">{shortcutLabel}</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu()
              window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT))
            }}
          >
            {t('help.menu.feedback')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu()
              setMilestonesOpen(true)
            }}
          >
            <span>{t('help.menu.milestones')}</span>
            <span className="help-menu__accessory">
              <ProgressRing
                compact
                progress={progress}
                label={t('help.milestones.progress')}
              />
            </span>
          </button>
          <span className="context-menu__separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => openHelpPage(DOCS_URL)}>
            {t('help.menu.docs')} <span className="help-menu__external">↗</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => openHelpPage(CHANGELOG_URL)}
          >
            {t('help.menu.changelog')}{' '}
            <span className="help-menu__external">↗</span>
          </button>
          <span className="context-menu__separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={checkingUpdate}
            onClick={() => {
              void checkUpdates().catch((error: unknown) => {
                console.error('[Bandal] 업데이트를 확인하지 못했습니다.', error)
                showToast(t('help.updateFailed'), 'danger')
              })
            }}
          >
            {t(checkingUpdate ? 'help.menu.checkingUpdate' : 'help.menu.checkUpdate')}
          </button>
          <p className="help-menu__version">
            {t('help.menu.version', {
              version: updateStatus?.currentVersion ?? '—'
            })}
          </p>
        </div>
      )}

      <ShortcutHelpOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
      <MilestonesOverlay
        open={milestonesOpen}
        selectedCourseId={selectedCourseId}
        onClose={() => setMilestonesOpen(false)}
        onTry={runMilestoneAction}
      />
      <FeedbackDialog />
    </>
  )
}
