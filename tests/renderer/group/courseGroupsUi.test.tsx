import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { IDockviewPanelProps } from 'dockview'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockedStores = vi.hoisted(() => ({
  auth: {
    auth: {
      phase: 'unconfigured',
      profile: null as null | {
        id: string
        nickname: string | null
        avatarColor: string
        avatarEmoji: string
      },
      online: false,
      errorCode: null
    },
    init: vi.fn(async () => undefined),
    signIn: vi.fn()
  },
  courses: {
    courses: [] as Course[],
    selectedCourseId: null as string | null
  },
  groups: {
    groups: [] as GroupSummary[],
    pendingInvites: [],
    init: vi.fn(async () => undefined),
    createGroup: vi.fn(),
    joinWithCode: vi.fn(),
    leaveGroup: vi.fn(),
    respondInvite: vi.fn()
  },
  workspace: {
    openTab: vi.fn()
  }
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {})
}))

vi.mock('../../../src/renderer/src/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mockedStores.auth) => unknown) =>
    selector(mockedStores.auth)
}))

vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: (selector: (state: typeof mockedStores.courses) => unknown) =>
    selector(mockedStores.courses)
}))

vi.mock('../../../src/renderer/src/stores/groupsStore', () => ({
  useGroupsStore: (selector: (state: typeof mockedStores.groups) => unknown) =>
    selector(mockedStores.groups),
  selectGroupsForCourse: (groups: GroupSummary[], courseId: string | null) =>
    groups.filter((entry) => entry.courseId === courseId)
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: (
    selector: (state: typeof mockedStores.workspace) => unknown
  ) => selector(mockedStores.workspace)
}))

import type { Course } from '../../../src/shared/types/course'
import type { GroupSummary } from '../../../src/shared/types/group'
import GroupChatTab from '../../../src/renderer/src/features/group/GroupChatTab'
import { CourseGroupsSection } from '../../../src/renderer/src/features/group/CourseGroupsSection'
import { TogetherFooter } from '../../../src/renderer/src/features/group/TogetherFooter'

const course: Course = {
  id: 'course-1',
  name: '알고리즘',
  slug: 'algorithm',
  color: 'blue',
  folderPath: '/courses/algorithm',
  source: 'managed',
  missing: false,
  archived: false,
  sortOrder: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

function group(
  id: string,
  name: string,
  courseId: string | null,
  unread = 0
): GroupSummary {
  return {
    id,
    name,
    color: 'blue',
    courseId,
    memberCount: 2,
    unread,
    lastMsgAt: null,
    joinedAt: '2026-08-01T00:00:00.000Z'
  }
}

function signIn(): void {
  mockedStores.auth.auth.phase = 'signed-in'
  mockedStores.auth.auth.profile = {
    id: 'user-1',
    nickname: '반달이',
    avatarColor: 'blue',
    avatarEmoji: '🌙'
  }
  mockedStores.auth.auth.online = true
}

function groupTabMarkup(
  courseId: string | null,
  initialGroupId?: string,
  view?: 'chat' | 'whiteboard'
): string {
  const payload = {
    courseId,
    ...(initialGroupId === undefined ? {} : { groupId: initialGroupId }),
    ...(view === undefined ? {} : { view })
  }
  const props = {
    params: { descriptor: { kind: 'group-chat', payload } },
    api: { close: vi.fn(), setTitle: vi.fn() }
  } as unknown as IDockviewPanelProps
  return renderToStaticMarkup(<GroupChatTab {...props} />)
}

beforeEach(() => {
  mockedStores.auth.auth.phase = 'unconfigured'
  mockedStores.auth.auth.profile = null
  mockedStores.auth.auth.online = false
  mockedStores.courses.courses = [course]
  mockedStores.courses.selectedCourseId = course.id
  mockedStores.groups.groups = []
  mockedStores.groups.pendingInvites = []
  vi.clearAllMocks()
})

describe('GroupChatTab course switcher', () => {
  test('defaults to chat and exposes the two-view segment', () => {
    mockedStores.groups.groups = [group('g-1', '전체방', course.id, 3)]

    const html = groupTabMarkup(course.id)

    expect(html).toContain('aria-label="함께하기 보기"')
    expect(html).toContain('aria-pressed="true">채팅')
    expect(html).toContain('화이트보드')
    expect(html).toContain('group-view-switcher__badge')
    expect(html).not.toContain('data-availability="loading"')
  })

  test('honors a whiteboard view request inside the same course panel', () => {
    mockedStores.groups.groups = [group('g-1', '전체방', course.id)]

    const html = groupTabMarkup(course.id, 'g-1', 'whiteboard')

    expect(html).toContain(
      'class="group-view-switcher__item" aria-pressed="true">화이트보드'
    )
    expect(html).toContain('data-availability="loading"')
  })

  test('shows only the course groups and honors the requested initial group', () => {
    mockedStores.groups.groups = [
      group('g-1', '전체방', course.id, 3),
      group('g-2', '우리조', course.id),
      group('g-other', '다른 과목', 'course-2'),
      group('g-none', '과목 미지정', null)
    ]

    const html = groupTabMarkup(course.id, 'g-2')

    expect(html).toContain('aria-label="그룹 선택"')
    expect(html).toContain('전체방')
    expect(html).toContain('읽지 않은 메시지 3개')
    expect(html).toContain(
      'aria-pressed="true"><span class="group-switcher__name">우리조'
    )
    expect(html).not.toContain('다른 과목')
    expect(html).not.toContain('과목 미지정')
  })

  test('hides the switcher when the course has only one group', () => {
    mockedStores.groups.groups = [group('g-1', '전체방', course.id)]

    expect(groupTabMarkup(course.id)).not.toContain('group-switcher')
  })
})

describe('TogetherFooter', () => {
  test('is absent when community auth is unconfigured', () => {
    expect(renderToStaticMarkup(<TogetherFooter />)).toBe('')
  })

  test('shows only unassigned groups in the global footer', () => {
    signIn()
    mockedStores.groups.groups = [
      group('g-none', '초대받은 방', null, 7),
      group('g-course', '과목 방', course.id)
    ]

    const html = renderToStaticMarkup(<TogetherFooter />)

    expect(html).toContain('코드로 참여')
    expect(html).toContain('과목 미지정')
    expect(html).toContain('초대받은 방')
    expect(html).toContain('읽지 않은 메시지 7개')
    expect(html).toContain('aria-label="초대받은 방 화이트보드 열기"')
    expect(html).not.toContain('과목 방')
  })
})

describe('CourseGroupsSection', () => {
  test('stays absent for a signed-out course with no groups', () => {
    mockedStores.auth.auth.phase = 'signed-out'

    expect(
      renderToStaticMarkup(<CourseGroupsSection courseId={course.id} />)
    ).toBe('')
  })

  test('renders only that course groups and its create action', () => {
    signIn()
    mockedStores.groups.groups = [
      group('g-course', '알고리즘 전체방', course.id, 2),
      group('g-other', '다른 과목 방', 'course-2')
    ]

    const html = renderToStaticMarkup(
      <CourseGroupsSection courseId={course.id} />
    )

    expect(html).toContain('알고리즘 전체방')
    expect(html).toContain('읽지 않은 메시지 2개')
    expect(html).toContain('aria-label="알고리즘 전체방 화이트보드 열기"')
    expect(html).toContain('이 과목으로 그룹 만들기')
    expect(html).not.toContain('다른 과목 방')
  })
})
