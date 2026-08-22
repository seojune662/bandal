import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'
import type { OverlayState } from '../../../src/shared/types/overlay'
import {
  CourseChip,
  loadOverlayCourses,
  selectOverlayCourse,
  useOverlayCoursesStore
} from '../../../src/renderer/src/features/overlay/CourseChip'
import { OverlayPopupApp } from '../../../src/renderer/src/features/overlay/OverlayPopupApp'
import {
  isOverlayOrbHit,
  reportOverlayOrbHitTest
} from '../../../src/renderer/src/features/overlay/OverlayOrbApp'
import { ScreenPermissionChip } from '../../../src/renderer/src/features/overlay/ScreenPermissionChip'
import {
  acquireOverlayState,
  INITIAL_OVERLAY_STATE,
  useOverlayStateStore
} from '../../../src/renderer/src/features/overlay/useOverlayState'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

const courses: Course[] = [
  {
    id: 'course-1',
    name: '고체역학',
    slug: 'solid-mechanics',
    color: 'green',
    folderPath: '/courses/solid-mechanics',
    source: 'managed',
    missing: false,
    archived: false,
    groupId: null,
    sortOrder: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  },
  {
    id: 'course-2',
    name: '자료구조',
    slug: 'data-structures',
    color: 'blue',
    folderPath: '/courses/data-structures',
    source: 'linked',
    missing: false,
    archived: false,
    groupId: null,
    sortOrder: 1,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  }
]

const loadedState: OverlayState = {
  mode: 'desktop',
  courseId: 'course-1',
  conversationId: 'conversation-1',
  popupOpen: true,
  screenPermission: 'granted'
}

afterEach(() => {
  setIpcAdapter(null)
  useOverlayStateStore.setState({ state: INITIAL_OVERLAY_STATE })
  useOverlayCoursesStore.setState({
    courses: [],
    loading: false,
    loadError: false
  })
})

describe('useOverlayState', () => {
  test('loads the initial snapshot and follows overlay state pushes', async () => {
    const invoke = vi.fn(async () => loadedState)
    let pushState: ((state: OverlayState) => void) | null = null
    setIpcAdapter({
      invoke,
      on: vi.fn((channel, handler) => {
        if (channel === 'overlay:state') {
          pushState = handler as (state: OverlayState) => void
        }
        return () => {
          pushState = null
        }
      })
    } as unknown as IpcAdapter)

    const release = acquireOverlayState()
    try {
      await vi.waitFor(() => {
        expect(useOverlayStateStore.getState().state).toEqual(loadedState)
      })

      expect(invoke).toHaveBeenCalledWith('overlay:getState', {})
      const pushedState: OverlayState = {
        ...loadedState,
        popupOpen: false,
        screenPermission: 'denied'
      }
      const deliverPush = pushState as ((state: OverlayState) => void) | null
      deliverPush?.(pushedState)
      expect(useOverlayStateStore.getState().state).toEqual(pushedState)
    } finally {
      release()
    }
  })
})

describe('OverlayOrbApp hit testing', () => {
  test('treats the orb disk and charm body as interactive', () => {
    const orb = { left: 92, top: 92, right: 148, bottom: 148, width: 56, height: 56 }
    const charm = { left: 104, top: 148, right: 136, bottom: 210, width: 32, height: 62 }

    expect(isOverlayOrbHit({ x: 120, y: 120 }, orb, charm)).toBe(true)
    expect(isOverlayOrbHit({ x: 120, y: 180 }, orb, charm)).toBe(true)
    expect(isOverlayOrbHit({ x: 20, y: 20 }, orb, charm)).toBe(false)
  })

  test('reports hit-test transitions through the overlay IPC channel', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await reportOverlayOrbHitTest(true)
    await reportOverlayOrbHitTest(false)

    expect(invoke.mock.calls).toEqual([
      ['overlay:setOrbHitTest', { hit: true }],
      ['overlay:setOrbHitTest', { hit: false }]
    ])
  })
})

describe('CourseChip', () => {
  test('loads and renders the course list with semantic color dots', async () => {
    const invoke = vi.fn(async () => courses)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await loadOverlayCourses()
    const html = renderToStaticMarkup(<CourseChip courseId="course-1" />)

    expect(invoke).toHaveBeenCalledWith('courses:list', {})
    expect(html).toContain('고체역학')
    expect(html).toContain('자료구조')
    expect(html).toContain('data-course-color="green"')
    expect(html).toContain('aria-selected="true"')
  })

  test('selects a course through overlay:setCourse and applies its state', async () => {
    const nextState: OverlayState = {
      ...loadedState,
      courseId: 'course-2',
      conversationId: null
    }
    const invoke = vi.fn(async () => nextState)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await expect(selectOverlayCourse('course-2')).resolves.toEqual(nextState)

    expect(invoke).toHaveBeenCalledWith('overlay:setCourse', {
      courseId: 'course-2'
    })
    expect(useOverlayStateStore.getState().state).toEqual(nextState)
  })
})

describe('ScreenPermissionChip', () => {
  test('renders the granted state', () => {
    const html = renderToStaticMarkup(
      <ScreenPermissionChip state="granted" />
    )
    expect(html).toContain('data-state="granted"')
    expect(html).toContain('화면 보기 허용됨')
  })

  test('collapses unknown and denied permission into the needed state', () => {
    for (const state of ['unknown', 'denied'] as const) {
      const html = renderToStaticMarkup(
        <ScreenPermissionChip state={state} />
      )
      expect(html).toContain('data-state="needed"')
      expect(html).toContain('화면 보기 허용 필요')
    }
  })

  test('renders nothing when screen capture is unsupported', () => {
    expect(
      renderToStaticMarkup(<ScreenPermissionChip state="unsupported" />)
    ).toBe('')
  })
})

describe('OverlayPopupApp', () => {
  test('shows the course-first empty state without a conversation', () => {
    useOverlayStateStore.setState({ state: INITIAL_OVERLAY_STATE })

    const html = renderToStaticMarkup(<OverlayPopupApp />)

    expect(html).toContain('class="overlay-popup"')
    expect(html).toContain('반달 AI')
    expect(html).toContain('과목을 먼저 고르세요')
    expect(html).not.toContain('class="chat-tab"')
  })
})
