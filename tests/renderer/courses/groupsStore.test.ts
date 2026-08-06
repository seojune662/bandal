import { describe, expect, test } from 'vitest'
import type { GroupSummary } from '../../../src/shared/types/group'
import {
  selectGroupsForCourse,
  selectUnassignedGroups
} from '../../../src/renderer/src/stores/groupsStore'

function group(id: string, courseId: string | null): GroupSummary {
  return {
    id,
    name: id,
    color: 'gold',
    courseId,
    memberCount: 1,
    unread: 0,
    lastMsgAt: null,
    joinedAt: '2026-08-07T00:00:00.000Z'
  }
}

describe('group course selectors', () => {
  const groups = [group('assigned-a', 'course-a'), group('free', null)]

  test('selects the groups assigned to one course', () => {
    expect(selectGroupsForCourse(groups, 'course-a').map((item) => item.id)).toEqual([
      'assigned-a'
    ])
  })

  test('selects only groups with no course', () => {
    expect(selectUnassignedGroups(groups).map((item) => item.id)).toEqual(['free'])
  })
})
