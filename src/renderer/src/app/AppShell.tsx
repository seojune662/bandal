import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { PushPayload } from '../../../shared/ipc/events'
import { invoke, onPush } from '../lib/ipc'
import { AssistantLayer } from '../features/assistant'
import { BoardOverlay } from '../features/board/BoardPanel'
import { LinkGraphOverlay } from '../features/links/graph/LinkGraphOverlay'
import { BrowserWebviewLayer } from '../features/browser/BrowserWebviewLayer'
import { PrintPreviewOverlay } from '../features/print/PrintPreviewOverlay'
import { usePrintRequests } from '../features/print/usePrintRequests'
import { useAgentWorkspaceSync } from '../features/agent/workspaceSync'
import { CourseSidebar } from '../features/courses/CourseSidebar'
import { MaterialsSidebar } from '../features/materials/MaterialsSidebar'
import { NicknameGate } from '../features/group/NicknameGate'
import { OnboardingOverlay } from '../features/onboarding/OnboardingOverlay'
import { useOnboardingStore } from '../features/onboarding/onboardingStore'
import { PreflightBanners } from '../features/onboarding/PreflightBanners'
import { TourOverlay } from '../features/onboarding/tour/TourOverlay'
import { useTourStore } from '../features/onboarding/tour/tourStore'
import { useAgentPreflight } from '../features/onboarding/useAgentPreflight'
import { SettingsApp } from '../features/settings/SettingsApp'
import { useUpdateNotifications } from '../features/updates/useUpdateNotifications'
import { WorkspaceHost } from '../features/workspace/WorkspaceHost'
import { RailResizer } from './RailResizer'
import { applyStoredRailWidths } from './railWidth'
import { descriptorFor } from '../features/workspace/tabIdentity'
import { selectNeedsNickname, useAuthStore } from '../stores/authStore'
import { useCoursesStore } from '../stores/coursesStore'
import { useUiStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useDownloads } from '../features/browser/downloadsStore'
import { useAgentRuns } from '../features/browser/AgentRunBanner'
import { useBrowserGuests } from '../features/browser/browserGuestsStore'
import { requestWebVideoResume } from '../features/browser/videoBridge'
import { requestVideoResume } from '../features/file/lib/videoProgress'
import { useUniversityStore } from '../stores/universityStore'
import { QuickFileSearch } from './QuickFileSearch'
import { useGlobalShortcuts } from './shortcuts'
import { ToastHost } from './toast'
import './app-shell.css'

export function AppShell(): JSX.Element {
  usePrintRequests()
  useAgentWorkspaceSync()
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const selectCourse = useCoursesStore((state) => state.selectCourse)
  const loadCourses = useCoursesStore((state) => state.loadCourses)
  const activeWorkspaceCourseId = useWorkspaceStore(
    (state) => state.activeCourseId
  )
  const workspaceHydration = useWorkspaceStore((state) => state.hydration)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const [pendingChat, setPendingChat] = useState<{
    courseId: string
    conversationId: string
  } | null>(null)
  const [pendingMaterial, setPendingMaterial] = useState<{
    courseId: string
    relPath: string
  } | null>(null)
  const consumedPendingOpen = useRef(false)
  const initTheme = useUiStore((state) => state.initTheme)
  const leftRailOpen = useUiStore((state) => state.leftRailOpen)
  const rightRailOpen = useUiStore((state) => state.rightRailOpen)
  // [M7] The 보드 entry point lives at the bottom of the left rail
  // (CourseSidebar) — this shell only owns the overlay itself.
  const isBoardOverlayOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const closeBoardOverlay = useUiStore((state) => state.closeBoardOverlay)
  const isLinkGraphOpen = useUiStore((state) => state.isLinkGraphOpen)
  const closeLinkGraph = useUiStore((state) => state.closeLinkGraph)
  const isSettingsOpen = useUiStore((state) => state.isSettingsOpen)
  const openSettings = useUiStore((state) => state.openSettings)
  const closeSettings = useUiStore((state) => state.closeSettings)
  const isOnboardingVisible = useOnboardingStore((state) => state.visible)
  // [P2-D] Signed in, but the account still carries the trigger's placeholder
  // handle. Never mounted before sign-in, so an unconfigured or signed-out
  // build never sees it (§1.4).
  const needsNickname = useAuthStore(selectNeedsNickname)

  const selectedCourse =
    courses.find((course) => course.id === selectedCourseId) ?? null

  // [M6-A] ⌘T/⌘W/⌘P/⌘,/⌘1..9 — see app/shortcuts.ts for the guard rules.
  useGlobalShortcuts()

  // Auto-update toasts. Inert in `pnpm dev` (main reports phase 'unsupported').
  useUpdateNotifications()

  useEffect(() => {
    void initTheme().catch((error: unknown) => {
      console.error('[Bandal] 테마 설정을 불러오지 못했습니다.', error)
    })
    void loadCourses()
    // [M6-A] First-run onboarding + live agent preflight (boot probe).
    void useOnboardingStore.getState().init()
    void useTourStore.getState().init()
    void useAgentPreflight.getState().probe()
    // [M8] 학교 바로가기 — the rail section renders nothing until this lands.
    void useUniversityStore.getState().init()
    useDownloads.getState().init()
    useAgentRuns.getState().init()
  }, [initTheme, loadCourses])

  // Browser downloads are filed under the selected course. Main only sees the
  // guest, so the renderer has to name the course — and re-name it on every
  // switch, or a download lands in whichever course was open at boot.
  useEffect(() => {
    void useDownloads
      .getState()
      .setTargetCourse(selectedCourseId)
      .catch((error: unknown) => {
        console.error('[Bandal] 다운로드 저장 위치를 설정하지 못했습니다.', error)
      })
  }, [selectedCourseId])

  // The assistant can now create, rename and remove courses on its own, so the
  // list has to follow changes it did not originate in this window.
  useEffect(() => {
    const unsubscribe = onPush('courses:changed', () => {
      void loadCourses()
    })
    return unsubscribe
  }, [loadCourses])

  useEffect(() => {
    return onPush('ui:openSettings', () => openSettings())
  }, [openSettings])

  useEffect(() => {
    return onPush('ui:openChat', (payload) => {
      setPendingChat(payload)
      selectCourse(payload.courseId)
    })
  }, [selectCourse])

  const handleOpenMaterial = useCallback(
    (payload: PushPayload<'ui:openMaterial'>): void => {
      requestVideoResume(payload.courseId, payload.relPath, {
        positionSec: payload.positionSec,
        playbackRate: payload.playbackRate
      })
      setPendingMaterial({
        courseId: payload.courseId,
        relPath: payload.relPath
      })
      selectCourse(payload.courseId)
    },
    [selectCourse]
  )

  const handleOpenUrl = useCallback(
    (payload: PushPayload<'ui:openUrl'>): void => {
      const workspace = useWorkspaceStore.getState()
      const browser = useBrowserGuests.getState()
      const normalizedUrl = (() => {
        try {
          return new URL(payload.url).href
        } catch {
          return payload.url
        }
      })()
      const existing = Object.values(workspace.openTabs).find((descriptor) => {
        if (descriptor.kind !== 'browser') return false
        const currentUrl =
          browser.nav[descriptor.payload.tabId]?.url ??
          descriptor.payload.initialUrl
        try {
          return new URL(currentUrl).href === normalizedUrl
        } catch {
          return currentUrl === normalizedUrl
        }
      })
      const tabId =
        existing?.kind === 'browser' ? existing.payload.tabId : uuidv4()
      requestWebVideoResume(tabId, {
        positionSec: payload.positionSec,
        playbackRate: payload.playbackRate
      })
      workspace.openTab(
        descriptorFor('browser', { tabId, initialUrl: payload.url })
      )
    },
    []
  )

  useEffect(() => {
    return onPush('ui:openMaterial', handleOpenMaterial)
  }, [handleOpenMaterial])

  useEffect(() => {
    return onPush('ui:openUrl', handleOpenUrl)
  }, [handleOpenUrl])

  useEffect(() => {
    if (consumedPendingOpen.current) return
    consumedPendingOpen.current = true
    // Same replay rule as deepLinkQueue: did-finish-load precedes React's
    // subscriptions, so a newly-created window pulls the buffered action only
    // after these onPush effects have mounted. Main clears it on this read.
    void invoke('ui:consumePendingOpen', {})
      .then((pending) => {
        if (pending?.material !== undefined) {
          handleOpenMaterial(pending.material)
        }
        if (pending?.url !== undefined) handleOpenUrl(pending.url)
      })
      .catch((error: unknown) => {
        console.error('[Bandal] 보류된 열기 요청을 가져오지 못했습니다.', error)
      })
  }, [handleOpenMaterial, handleOpenUrl])

  useEffect(() => {
    if (pendingChat === null) return
    if (selectedCourseId !== pendingChat.courseId) {
      if (courses.some((course) => course.id === pendingChat.courseId)) {
        selectCourse(pendingChat.courseId)
      }
      return
    }
    if (
      activeWorkspaceCourseId !== pendingChat.courseId ||
      workspaceHydration !== 'ready'
    ) {
      return
    }
    openTab(
      descriptorFor('chat', {
        courseId: pendingChat.courseId,
        conversationId: pendingChat.conversationId
      })
    )
    setPendingChat((current) =>
      current?.courseId === pendingChat.courseId &&
      current.conversationId === pendingChat.conversationId
        ? null
        : current
    )
  }, [
    activeWorkspaceCourseId,
    courses,
    openTab,
    pendingChat,
    selectCourse,
    selectedCourseId,
    workspaceHydration
  ])

  useEffect(() => {
    if (pendingMaterial === null) return
    if (selectedCourseId !== pendingMaterial.courseId) {
      if (courses.some((course) => course.id === pendingMaterial.courseId)) {
        selectCourse(pendingMaterial.courseId)
      }
      return
    }
    if (
      activeWorkspaceCourseId !== pendingMaterial.courseId ||
      workspaceHydration !== 'ready'
    ) {
      return
    }
    openTab(
      descriptorFor('file', {
        courseId: pendingMaterial.courseId,
        relPath: pendingMaterial.relPath
      })
    )
    setPendingMaterial((current) =>
      current?.courseId === pendingMaterial.courseId &&
      current.relPath === pendingMaterial.relPath
        ? null
        : current
    )
  }, [
    activeWorkspaceCourseId,
    courses,
    openTab,
    pendingMaterial,
    selectCourse,
    selectedCourseId,
    workspaceHydration
  ])

  useEffect(() => {
    if (!isSettingsOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeSettings()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeSettings, isSettingsOpen])

  // [M5] A file dropped outside a drop target must never navigate the window.
  useEffect(() => {
    const prevent = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // 저장된 사이드바 폭 복원 (없으면 tokens.css 기본값 그대로).
  useEffect(() => {
    applyStoredRailWidths()
  }, [])

  return (
    <div
      className="app-shell"
      data-left-rail={leftRailOpen ? 'open' : 'closed'}
      data-right-rail={rightRailOpen ? 'open' : 'closed'}
    >
      {/* [M9] No dedicated titlebar row — that buys back a full
          --chrome-height of vertical space. The chrome is split by who owns
          the window's top-left corner:
            - rail OPEN  → CourseSidebar's brand row (반달 mark + traffic-light
              inset + collapse toggle) sits there.
            - rail CLOSED → WorkspaceHost's ChromeLeft takes over with the
              inset + an expand toggle, so the rail is never unrecoverable.
          WorkspaceHost also owns `+` (after the last tab) and the right
          rail toggle. */}
      {leftRailOpen && <CourseSidebar />}
      {leftRailOpen && <RailResizer side="left" />}

      <main className="app-workspace" aria-label="작업 공간">
        <PreflightBanners suppressed={isOnboardingVisible} />
        <WorkspaceHost />
      </main>

      {rightRailOpen && <MaterialsSidebar course={selectedCourse} />}
      {rightRailOpen && <RailResizer side="right" />}

      <BrowserWebviewLayer />
      <PrintPreviewOverlay />
      {isBoardOverlayOpen && <BoardOverlay onClose={closeBoardOverlay} />}
      {isLinkGraphOpen && selectedCourse !== null && (
        <LinkGraphOverlay
          courseId={selectedCourse.id}
          onClose={closeLinkGraph}
        />
      )}
      <QuickFileSearch />
      {/* One modal at a time: first-run onboarding outranks the nickname step,
          which waits for the wizard to close. */}
      {isOnboardingVisible ? (
        <OnboardingOverlay />
      ) : (
        needsNickname && <NicknameGate />
      )}
      {/* [M9] The 반달 orb, its popup chat and the selection-following orb.
          Mounted at shell level (not inside a panel) so the conversation
          survives tab switches — the session itself lives in chatSessionStore,
          keyed by course, so the tab and the popup share one dialogue. */}
      <AssistantLayer />
      <ToastHost />
      {isSettingsOpen && (
        <div className="settings-overlay">
          <SettingsApp embedded onClose={closeSettings} />
        </div>
      )}
      <TourOverlay />
    </div>
  )
}
