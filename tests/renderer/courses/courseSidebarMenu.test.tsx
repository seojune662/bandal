// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'

const uiState = vi.hoisted(() => ({
  isBoardOverlayOpen: false,
  toggleBoardOverlay: vi.fn(),
  isLinkGraphOpen: false,
  toggleLinkGraph: vi.fn(),
  toggleLeftRail: vi.fn(),
  openSettings: vi.fn()
}))
const authState = vi.hoisted(() => ({ phase: 'unconfigured' }))
const friendsState = vi.hoisted(() => ({
  friends: [] as unknown[],
  init: vi.fn(async () => undefined)
}))
const workspaceState = vi.hoisted(() => ({ openTab: vi.fn() }))

vi.mock('../../../src/renderer/src/stores/uiStore', () => ({
  useUiStore: (selector: (state: typeof uiState) => unknown) => selector(uiState)
}))
vi.mock('../../../src/renderer/src/stores/authStore', () => ({
  useAuthStore: (
    selector: (state: { auth: typeof authState }) => unknown
  ) => selector({ auth: authState })
}))
vi.mock('../../../src/renderer/src/stores/friendsStore', () => ({
  useFriendsStore: (selector: (state: typeof friendsState) => unknown) =>
    selector(friendsState)
}))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) =>
    selector(workspaceState)
}))
vi.mock('../../../src/renderer/src/features/account/SidebarAccountEntry', () => ({
  SidebarAccountEntry: () => (
    <button type="button" className="rail-nav__item" aria-label="내 프로필" />
  )
}))
vi.mock('../../../src/renderer/src/features/group/TogetherFooter', () => ({
  TogetherFooter: () => null
}))
vi.mock('../../../src/renderer/src/features/help/HelpHub', () => ({
  HelpHub: () => (
    <button type="button" className="rail-nav__item" aria-label="도움말" />
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

import { CourseSidebar } from '../../../src/renderer/src/features/courses/CourseSidebar'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'

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
  invokeMock.mockReset()
  authState.phase = 'unconfigured'
  friendsState.friends = []
  friendsState.init.mockClear()
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
  setIpcAdapter(null)
})

describe('CourseSidebar course menu', () => {
  test('puts the friends entry in the bottom icon navigation', () => {
    authState.phase = 'signed-in'
    act(() => root.render(<CourseSidebar />))

    const button = container.querySelector<HTMLButtonElement>(
      '.rail-footer [aria-label="친구"]'
    )
    expect(button).not.toBeNull()
    expect(container.querySelector('.together-friends')).toBeNull()

    act(() => button?.click())
    expect(workspaceState.openTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'friends' })
    )
  })

  test('keeps profile, settings, help, friends, graph and board in that order', () => {
    authState.phase = 'signed-in'
    act(() => root.render(<CourseSidebar />))

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>('.rail-nav > .rail-nav__item')
    ).map((item) => item.getAttribute('aria-label'))

    expect(labels).toEqual([
      '내 프로필',
      '설정',
      '도움말',
      '친구',
      '연결 그래프',
      '학업 보드 열기'
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
