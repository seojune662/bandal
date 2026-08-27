import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {})
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  EMPTY_MILESTONE_FACTS,
  deriveMilestones,
  useMilestones
} from '../../../src/renderer/src/features/help/milestonesStore'

const invokeMock = vi.mocked(invoke)

beforeEach(() => {
  vi.clearAllMocks()
  useMilestones.setState({
    facts: EMPTY_MILESTONE_FACTS,
    items: deriveMilestones(EMPTY_MILESTONE_FACTS),
    progress: 0,
    loading: false,
    error: null
  })
})

describe('milestone refresh', () => {
  test('derives the checklist from the selected course and lightweight activity', async () => {
    invokeMock.mockImplementation(async (channel, request) => {
      switch (channel) {
        case 'settings:get':
          return {
            ...DEFAULT_SETTINGS,
            university: {
              ...DEFAULT_SETTINGS.university,
              universityId: 'snu'
            },
            tutorial: { seenVersion: 1, activeCourseId: null },
            milestones: { pipUsedAt: '2026-08-27T12:00:00.000Z' }
          }
        case 'courses:list':
          return [
            {
              id: 'course-1',
              name: '자료구조',
              slug: 'data-structures',
              color: 'gold',
              folderPath: '/courses/data-structures',
              source: 'managed',
              missing: false,
              archived: false,
              groupId: null,
              sortOrder: 0,
              createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z'
            }
          ]
        case 'auth:getState':
          return {
            phase: 'unconfigured',
            profile: null,
            email: null,
            online: false,
            errorCode: null
          }
        case 'agent:availability':
          return { installed: true, loggedIn: true }
        case 'materials:tree':
          expect(request).toEqual({ courseId: 'course-1' })
          return [{ relPath: 'lecture.pdf', name: 'lecture.pdf', kind: 'pdf' }]
        case 'favorites:list':
          return request.courseId === 'course-1'
            ? [
                {
                  id: 'favorite-1',
                  courseId: 'course-1',
                  label: '강의',
                  descriptor: {
                    kind: 'pdf',
                    payload: { courseId: 'course-1', relPath: 'lecture.pdf' }
                  },
                  sortOrder: 0,
                  createdAt: '2026-08-27T00:00:00.000Z',
                  updatedAt: '2026-08-27T00:00:00.000Z'
                }
              ]
            : []
        case 'activity:recent':
          return [
            {
              id: 'activity-1',
              courseId: 'course-1',
              kind: 'question-asked',
              relPath: null,
              summary: '질문',
              createdAt: '2026-08-27T00:00:00.000Z'
            }
          ]
        default:
          throw new Error(`Unexpected channel: ${channel}`)
      }
    })

    await useMilestones.getState().refresh('course-1')

    const state = useMilestones.getState()
    expect(state.items).toHaveLength(8)
    expect(state.items.every((item) => item.completed)).toBe(true)
    expect(state.items.map((item) => item.id)).not.toContain('group')
    expect(state.progress).toBe(100)
    expect(invokeMock).not.toHaveBeenCalledWith('groups:list', {})
    expect(invokeMock).toHaveBeenCalledWith('activity:recent', {
      courseId: 'course-1',
      limit: 50
    })
  })
})
