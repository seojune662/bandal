import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { GroupSummary } from '../../../src/shared/types/group'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {})
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)

import {
  resetGroupsStoreForTests,
  useGroupsStore
} from '../../../src/renderer/src/stores/groupsStore'

const restoredGroup: GroupSummary = {
  id: 'group-1',
  name: '알고리즘 스터디',
  color: 'blue',
  courseId: 'course-1',
  memberCount: 3,
  unread: 4,
  lastMsgAt: '2026-08-10T10:00:00.000Z',
  joinedAt: '2026-08-01T10:00:00.000Z'
}

beforeEach(() => {
  resetGroupsStoreForTests()
  vi.clearAllMocks()
  ipc.invoke.mockImplementation((channel: string) => {
    if (channel === 'groups:list') return Promise.resolve([restoredGroup])
    if (channel === 'invites:listPending') return Promise.resolve([])
    throw new Error(`unexpected IPC: ${channel}`)
  })
})

describe('group projection restoration', () => {
  test('coalesces overlapping loads while preserving groups and unread counts', async () => {
    await Promise.all([
      useGroupsStore.getState().init(),
      useGroupsStore.getState().init()
    ])

    expect(ipc.invoke).toHaveBeenCalledTimes(2)
    expect(useGroupsStore.getState().groups).toEqual([restoredGroup])
    expect(useGroupsStore.getState().groups[0]?.unread).toBe(4)
  })

  test('allows a later init to refresh after an account change', async () => {
    await useGroupsStore.getState().init()
    await useGroupsStore.getState().init()

    expect(ipc.invoke).toHaveBeenCalledTimes(4)
  })
})
