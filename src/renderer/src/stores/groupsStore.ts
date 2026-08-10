/**
 * Group list + unread badges for the 함께하기 rail.
 *
 * Reads are answered by main from SQLite, so `load()` is effectively free and
 * works offline; `groups:invalidated` pushes tell us when to refetch rather
 * than shipping a payload — that keeps the local cache the single projection
 * of truth instead of creating a second one here.
 */

import { create } from 'zustand'
import type {
  GroupCreateResult,
  GroupSummary,
  JoinGroupResult,
  PendingGroupInvite
} from '../../../shared/types/group'
import { invoke, onPush } from '../lib/ipc'

interface GroupsStoreState {
  groups: GroupSummary[]
  pendingInvites: PendingGroupInvite[]
  isLoading: boolean
  error: string | null
  /** Hydrate + subscribe to invalidation. Safe to call repeatedly. */
  init: () => Promise<void>
  load: () => Promise<void>
  createGroup: (input: {
    name: string
    color: string
    courseId?: string
  }) => Promise<GroupCreateResult>
  joinWithCode: (code: string) => Promise<JoinGroupResult>
  linkCourse: (groupId: string, courseId: string | null) => Promise<void>
  leaveGroup: (groupId: string) => Promise<void>
  respondInvite: (inviteId: string, accept: boolean) => Promise<void>
  clearError: () => void
}

let subscribed = false
let initialization: Promise<void> | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '문제가 생겼어요.'
}

export const useGroupsStore = create<GroupsStoreState>()((set, get) => ({
  groups: [],
  pendingInvites: [],
  isLoading: false,
  error: null,

  init: async () => {
    if (!subscribed) {
      subscribed = true
      onPush('groups:invalidated', () => {
        void get().load()
      })
    }
    if (initialization === null) {
      const request = get().load()
      initialization = request
      void request.finally(() => {
        // Coalesce only overlapping mounts. A later sign-in (including an
        // account switch in the same app run) must refresh the projection.
        if (initialization === request) initialization = null
      })
    }
    await initialization
  },

  load: async () => {
    set({ isLoading: true })
    try {
      const [groups, pendingInvites] = await Promise.all([
        invoke('groups:list', {}),
        invoke('invites:listPending', {})
      ])
      set({ groups, pendingInvites, isLoading: false, error: null })
    } catch (error) {
      // A failed refresh keeps whatever the cache already gave us; the rail
      // must not blank out because the network hiccuped.
      set({ isLoading: false, error: errorMessage(error) })
    }
  },

  createGroup: async (input) => {
    const payload: { name: string; color: string; courseId?: string } = {
      name: input.name,
      color: input.color
    }
    if (input.courseId !== undefined) payload.courseId = input.courseId
    const result = await invoke('groups:create', payload)
    set({ groups: [result.group, ...get().groups] })
    return result
  },

  joinWithCode: async (code) => {
    const result = await invoke('groups:joinWithCode', { code })
    if (result.ok) await get().load()
    return result
  },

  linkCourse: async (groupId, courseId) => {
    const updated = await invoke('groups:linkCourse', { groupId, courseId })
    set({
      groups: get().groups.map((group) =>
        group.id === groupId ? updated : group
      )
    })
  },

  leaveGroup: async (groupId) => {
    await invoke('groups:leave', { groupId })
    set({ groups: get().groups.filter((group) => group.id !== groupId) })
  },

  respondInvite: async (inviteId, accept) => {
    await invoke('invites:respond', { inviteId, accept })
    set({
      pendingInvites: get().pendingInvites.filter(
        (invite) => invite.inviteId !== inviteId
      )
    })
    if (accept) await get().load()
  },

  clearError: () => {
    set({ error: null })
  }
}))

/** Groups pinned under one course, plus the unpinned ones when `null`. */
export function selectGroupsForCourse(
  groups: readonly GroupSummary[],
  courseId: string | null
): GroupSummary[] {
  return groups.filter((group) => group.courseId === courseId)
}

/** Groups joined before the user assigns them to a course. */
export function selectUnassignedGroups(
  groups: readonly GroupSummary[]
): GroupSummary[] {
  return groups.filter((group) => group.courseId === null)
}

export function selectTotalUnread(groups: readonly GroupSummary[]): number {
  return groups.reduce((sum, group) => sum + group.unread, 0)
}

/** Test-only: drop the push subscription latch. */
export function resetGroupsStoreForTests(): void {
  subscribed = false
  initialization = null
  useGroupsStore.setState({
    groups: [],
    pendingInvites: [],
    isLoading: false,
    error: null
  })
}
