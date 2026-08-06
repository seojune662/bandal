import { useEffect } from 'react'
import { AssistantLayer } from '../features/assistant'
import { BoardOverlay } from '../features/board/BoardPanel'
import { BrowserWebviewLayer } from '../features/browser/BrowserWebviewLayer'
import { CourseSidebar } from '../features/courses/CourseSidebar'
import { MaterialsSidebar } from '../features/materials/MaterialsSidebar'
import { NicknameGate } from '../features/group/NicknameGate'
import { OnboardingOverlay } from '../features/onboarding/OnboardingOverlay'
import { useOnboardingStore } from '../features/onboarding/onboardingStore'
import { PreflightBanners } from '../features/onboarding/PreflightBanners'
import { useAgentPreflight } from '../features/onboarding/useAgentPreflight'
import { useUpdateNotifications } from '../features/updates/useUpdateNotifications'
import { WorkspaceHost } from '../features/workspace/WorkspaceHost'
import { selectNeedsNickname, useAuthStore } from '../stores/authStore'
import { useCoursesStore } from '../stores/coursesStore'
import { useUiStore } from '../stores/uiStore'
import { useUniversityStore } from '../stores/universityStore'
import { QuickFileSearch } from './QuickFileSearch'
import { useGlobalShortcuts } from './shortcuts'
import { ToastHost } from './toast'
import './app-shell.css'

export function AppShell(): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const loadCourses = useCoursesStore((state) => state.loadCourses)
  const initTheme = useUiStore((state) => state.initTheme)
  const leftRailOpen = useUiStore((state) => state.leftRailOpen)
  const rightRailOpen = useUiStore((state) => state.rightRailOpen)
  // [M7] The 보드 entry point lives at the bottom of the left rail
  // (CourseSidebar) — this shell only owns the overlay itself.
  const isBoardOverlayOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const closeBoardOverlay = useUiStore((state) => state.closeBoardOverlay)
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
    void useAgentPreflight.getState().probe()
    // [M8] 학교 바로가기 — the rail section renders nothing until this lands.
    void useUniversityStore.getState().init()
  }, [initTheme, loadCourses])

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

  return (
    <div
      className="app-shell"
      data-left-rail={leftRailOpen ? 'open' : 'closed'}
      data-right-rail={rightRailOpen ? 'open' : 'closed'}
    >
      {/* [M9] No dedicated titlebar row. The dockview tab strip IS the window
          chrome now (WorkspaceHost's ChromeLeft/HeaderActions own the traffic
          light inset, the 반달 mark and both rail toggles), which buys back a
          full --chrome-height of vertical space. */}
      {leftRailOpen && <CourseSidebar />}

      <main className="app-workspace" aria-label="작업 공간">
        <PreflightBanners suppressed={isOnboardingVisible} />
        <WorkspaceHost />
      </main>

      {rightRailOpen && <MaterialsSidebar course={selectedCourse} />}

      <BrowserWebviewLayer />
      {isBoardOverlayOpen && <BoardOverlay onClose={closeBoardOverlay} />}
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
    </div>
  )
}
