import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  renderTogether: null as null | (() => unknown),
  authInvoke: vi.fn(),
  auth: {
    auth: {
      phase: 'unconfigured',
      profile: null,
      online: false,
      errorCode: null
    },
    hydrated: false,
    initializing: false,
    init: vi.fn(async () => undefined),
    signIn: vi.fn()
  },
  groups: {
    groups: [],
    pendingInvites: [],
    init: vi.fn(async () => undefined),
    joinWithCode: vi.fn(),
    respondInvite: vi.fn()
  },
  courses: {
    courses: [],
    selectedCourseId: null,
    loadCourses: vi.fn(async () => undefined)
  },
  ui: {
    initTheme: vi.fn(async () => undefined),
    leftRailOpen: true,
    rightRailOpen: false,
    isBoardOverlayOpen: false,
    closeBoardOverlay: vi.fn()
  }
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useCallback: <T,>(callback: T): T => callback,
    useEffect: (effect: () => void | (() => void)): void => {
      harness.effects.push(effect)
    },
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: <T,>(initial: T): { current: T } => ({ current: initial }),
    useState: <T,>(initial: T | (() => T)): [T, () => void] => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      () => undefined
    ]
  }
})

vi.mock('../../../src/renderer/src/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof harness.auth) => unknown) =>
      selector(harness.auth),
    { getState: () => harness.auth }
  ),
  selectNeedsNickname: () => false
}))

vi.mock('../../../src/renderer/src/stores/groupsStore', () => ({
  useGroupsStore: (selector: (state: typeof harness.groups) => unknown) =>
    selector(harness.groups),
  selectGroupsForCourse: () => []
}))

vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: Object.assign(
    (selector: (state: typeof harness.courses) => unknown) =>
      selector(harness.courses),
    {
      // The shell publishes app state to the agent and reads both stores
      // imperatively to do it.
      getState: () => harness.courses,
      subscribe: () => () => undefined
    }
  )
}))

vi.mock('../../../src/renderer/src/stores/uiStore', () => ({
  useUiStore: (selector: (state: typeof harness.ui) => unknown) =>
    selector(harness.ui)
}))

vi.mock('../../../src/renderer/src/features/courses/CourseSidebar', () => ({
  CourseSidebar: () => harness.renderTogether?.() ?? null
}))

vi.mock('../../../src/renderer/src/features/materials/MaterialsSidebar', () => ({
  MaterialsSidebar: () => null
}))

vi.mock('../../../src/renderer/src/components/BandalMark', () => ({
  BandalMark: () => null
}))

vi.mock('../../../src/renderer/src/features/assistant', () => ({
  AssistantLayer: () => null
}))

vi.mock('../../../src/renderer/src/features/board/BoardPanel', () => ({
  BoardOverlay: () => null
}))

vi.mock('../../../src/renderer/src/features/browser/BrowserWebviewLayer', () => ({
  BrowserWebviewLayer: () => null
}))

vi.mock('../../../src/renderer/src/features/group/NicknameGate', () => ({
  NicknameGate: () => null
}))

vi.mock('../../../src/renderer/src/features/onboarding/OnboardingOverlay', () => ({
  OnboardingOverlay: () => null
}))

vi.mock('../../../src/renderer/src/features/onboarding/PreflightBanners', () => ({
  PreflightBanners: () => null
}))

vi.mock('../../../src/renderer/src/features/workspace/WorkspaceHost', () => ({
  WorkspaceHost: () => null
}))

vi.mock('../../../src/renderer/src/app/QuickFileSearch', () => ({
  QuickFileSearch: () => null
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  ToastHost: () => null,
  showToast: vi.fn()
}))

vi.mock('../../../src/renderer/src/app/shortcuts', () => ({
  useGlobalShortcuts: vi.fn()
}))

vi.mock('../../../src/renderer/src/features/updates/useUpdateNotifications', () => ({
  useUpdateNotifications: vi.fn()
}))

vi.mock('../../../src/renderer/src/features/onboarding/onboardingStore', () => {
  const useOnboardingStore = (
    selector: (state: { visible: boolean }) => unknown
  ): unknown => selector({ visible: false })
  useOnboardingStore.getState = () => ({ init: vi.fn() })
  return { useOnboardingStore }
})

vi.mock('../../../src/renderer/src/features/onboarding/useAgentPreflight', () => ({
  useAgentPreflight: { getState: () => ({ probe: vi.fn() }) }
}))

vi.mock('../../../src/renderer/src/stores/universityStore', () => ({
  useUniversityStore: { getState: () => ({ init: vi.fn() }) }
}))

// The shell mounts the print preview; this walk calls components as plain
// functions, so its store needs the same stub treatment as the others.
vi.mock('../../../src/renderer/src/features/print/printStore', () => ({
  usePrintStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ target: null, phase: { status: 'rendering' }, prefs: {}, title: '' }),
    { getState: () => ({ open: vi.fn(), close: vi.fn() }) }
  )
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: Object.assign(
    (selector: (state: { openTab: ReturnType<typeof vi.fn> }) => unknown) =>
      selector({ openTab: vi.fn() }),
    {
      // usePrintRequests reads the focused tab imperatively to decide whether
      // 파일 ▸ 인쇄… owns ⌘P.
      getState: () => ({ activeTabDescriptor: () => null }),
      subscribe: () => () => undefined
    }
  )
}))

import React from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { AppShell } from '../../../src/renderer/src/app/AppShell'
import GroupChatTab from '../../../src/renderer/src/features/group/GroupChatTab'
import { TogetherFooter } from '../../../src/renderer/src/features/group/TogetherFooter'

function walk(node: ReactNode, visit: (element: ReactElement) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  if (!React.isValidElement(node)) return

  if (typeof node.type === 'function') {
    walk(node.type(node.props), visit)
    return
  }

  visit(node)
  walk((node.props as { children?: ReactNode }).children, visit)
}

beforeEach(() => {
  harness.effects.length = 0
  harness.auth.auth.phase = 'unconfigured'
  harness.auth.auth.profile = null
  harness.auth.auth.online = false
  harness.auth.hydrated = false
  harness.auth.initializing = false
  harness.authInvoke.mockReset()
  harness.auth.init.mockReset()
  harness.groups.init.mockClear()
  harness.auth.init.mockImplementation(async () => {
    harness.authInvoke('auth:getState', {})
  })
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    // The shell subscribes to `courses:changed` now that the assistant can
    // change the course list on its own. Unrelated to auth, but it runs in the
    // same effect pass, and a missing `on` took the whole render down.
    bandal: { on: vi.fn(() => () => undefined) },
    // The shell debounces its app-state publish; a window without timers takes
    // the whole render down.
    setTimeout: vi.fn(() => 0),
    clearTimeout: vi.fn(),
    requestAnimationFrame: vi.fn(() => 0),
    cancelAnimationFrame: vi.fn()
  })
  harness.renderTogether = () => <TogetherFooter />
})

describe('app shell auth restoration', () => {
  test('restores auth automatically on shell mount without a click', () => {
    walk(AppShell(), () => undefined)

    for (const effect of harness.effects) effect()

    expect(harness.authInvoke).toHaveBeenCalledWith('auth:getState', {})
  })

  test('restores auth before groups when a saved group tab mounts', async () => {
    harness.auth.init.mockImplementation(async () => {
      harness.authInvoke('auth:getState', {})
      harness.auth.auth.phase = 'signed-in'
      harness.auth.hydrated = true
    })
    const props = {
      params: {
        descriptor: {
          kind: 'group-chat',
          payload: { courseId: 'course-1', groupId: 'group-1', view: 'chat' }
        }
      },
      api: { close: vi.fn(), setTitle: vi.fn() }
    } as unknown as IDockviewPanelProps

    walk(GroupChatTab(props), () => undefined)
    for (const effect of harness.effects) effect()

    await vi.waitFor(() => {
      expect(harness.authInvoke).toHaveBeenCalledWith('auth:getState', {})
      expect(harness.groups.init).toHaveBeenCalledTimes(1)
    })
    expect(harness.authInvoke.mock.invocationCallOrder[0]).toBeLessThan(
      harness.groups.init.mock.invocationCallOrder[0]!
    )
  })
})
