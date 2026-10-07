// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// jsdom has no layout observer; viewport geometry is covered in Electron E2E.
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })

import type { Course } from '../../../src/shared/types/course'

const uiState = vi.hoisted(() => ({
  isBoardOverlayOpen: false,
  toggleBoardOverlay: vi.fn(),
  isLinkGraphOpen: false,
  toggleLinkGraph: vi.fn(),
  toggleLeftRail: vi.fn(),
  openSettings: vi.fn(),
  closeBoardOverlay: vi.fn(),
  closeLinkGraph: vi.fn(),
  closeSettings: vi.fn()
}))
const authState = vi.hoisted(() => ({ phase: 'unconfigured' }))
const workspaceState = vi.hoisted(() => ({ openTab: vi.fn(), showCourseWorkspace: vi.fn(), surface: 'course', activePanelSource: () => null }))

vi.mock('../../../src/renderer/src/stores/uiStore', () => ({
  useUiStore: Object.assign((selector: (state: typeof uiState) => unknown) => selector(uiState), { getState: () => uiState })
}))
vi.mock('../../../src/renderer/src/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: { auth: typeof authState }) => unknown) => selector({ auth: authState }), { getState: () => ({ init: async () => undefined }) })
}))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: Object.assign((selector: (state: typeof workspaceState) => unknown) => selector(workspaceState), { getState: () => workspaceState, subscribe: () => () => {} })
}))
vi.mock('../../../src/renderer/src/features/account/SidebarAccountEntry', () => ({
  SidebarAccountEntry: () => (
    <button type="button" className="rail-nav__item" aria-label="내 프로필" />
  )
}))
vi.mock('../../../src/renderer/src/features/help/HelpHub', () => ({
  HelpHub: () => (
    <button type="button" className="rail-nav__item" aria-label="더 보기" />
  )
}))
vi.mock('../../../src/renderer/src/features/university/UniversityShortcuts', () => ({
  UniversityShortcuts: () => null
}))
vi.mock('../../../src/renderer/src/features/workspace/workspaceIcons', () => ({
  TabKindIcon: () => null
}))
vi.mock('../../../src/renderer/src/features/courses/FavoritesSection', () => ({
  FavoritesSection: () => null
}))
vi.mock('../../../src/renderer/src/features/courses/CourseDialogs', () => ({
  ArchiveCourseDialog: () => null,
  CourseFormDialog: () => null,
  DeleteCourseDialog: () => null
}))
vi.mock('../../../src/renderer/src/features/courses/CourseGroupDialogs', () => ({
  CourseGroupNameDialog: () => null,
  DeleteCourseGroupDialog: () => null
}))

import { GlobalNavigation } from '../../../src/renderer/src/app/GlobalNavigation'
import { CourseSidebar } from '../../../src/renderer/src/features/courses/CourseSidebar'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { resetUpdateStoreForTests } from '../../../src/renderer/src/stores/updateStore'

const invokeMock = vi.fn<(channel: string, req: unknown) => Promise<unknown>>()

const course: Course = {
  id: 'course-1',
  name: '항공역학',
  slug: 'aerodynamics',
  color: 'green',
  folderPath: '/courses/aerodynamics',
  source: 'managed',
  missing: false,
  archived: false,
  groupId: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  Object.assign(window, {
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn()
  })
  resetUpdateStoreForTests()
  invokeMock.mockReset()
  invokeMock.mockImplementation(async channel => channel === 'update:status'
    ? { phase: 'unsupported', currentVersion: 'fixture' } : undefined)
  authState.phase = 'unconfigured'
  workspaceState.openTab.mockClear()
  setIpcAdapter({
    invoke: invokeMock,
    on: vi.fn(() => () => undefined)
  } as unknown as IpcAdapter)
  useCoursesStore.setState({
    courses: [course],
    groups: [],
    selectedCourseId: null,
    isLoading: false,
    pendingCourseId: null,
    error: null
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<CourseSidebar />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  resetUpdateStoreForTests()
  setIpcAdapter(null)
})

describe('CourseSidebar course menu', () => {

  test('keeps independent study workspaces out of course and semester lists', () => {
    act(() => useCoursesStore.setState({ courses: [course, { ...course, id: 'study-1', name: '나의 영어 읽기', workspaceKind: 'study-space' }] }))
    expect(container.querySelector('[aria-label="항공역학 과목 메뉴"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="나의 영어 읽기 과목 메뉴"]')).toBeNull()
    expect(container.querySelector('.learning-sidebar')).toBeNull()
  })

  test('keeps primary navigation above account and settings', async () => {
    authState.phase = 'signed-in'
    await act(async () => root.render(<><GlobalNavigation /><CourseSidebar /></>))

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>('.global-navigation .rail-nav__item')
    ).map((item) => item.getAttribute('aria-label'))

    expect(invokeMock).toHaveBeenCalledWith('update:status', {})
    expect(container.querySelector('.rail-update-button')).toBeNull()
    expect(labels).toEqual([
      '과목', '학습', '학업 보드 열기', 'AI', '도구', '더 보기', '내 프로필', '설정'
    ])
  })

  test('opens from the ellipsis button and changes the course color', async () => {
    const menuButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="항공역학 과목 메뉴"]'
    )
    expect(menuButton).not.toBeNull()

    act(() => {
      menuButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    const menu = container.querySelector('[role="menu"][aria-label="항공역학 과목 메뉴"]')
    const swatches = menu?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]'
    )
    expect(menu).not.toBeNull()
    expect(swatches).toHaveLength(6)
    expect(menu?.querySelector('[aria-label="세이지"]')?.getAttribute('aria-checked')).toBe(
      'true'
    )

    const updated = { ...course, color: 'blue' }
    invokeMock.mockResolvedValue(updated)
    const blue = menu?.querySelector<HTMLButtonElement>('[aria-label="블루"]')
    await act(async () => {
      blue?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    expect(invokeMock).toHaveBeenCalledWith('courses:setColor', {
      courseId: course.id,
      color: 'blue'
    })
    expect(useCoursesStore.getState().courses[0]?.color).toBe('blue')
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})
