import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { GroupMember, GroupMessage } from '../../../src/shared/types/group'
import {
  createGroupRepo,
  type GroupRepo
} from '../../../src/main/features/group/groupRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

let testDb: TestDb
let repo: GroupRepo

function seedCourse(name = '자료구조'): string {
  const id = randomUUID()
  const now = new Date().toISOString()
  testDb.db
    .prepare(
      `INSERT INTO courses
         (id, name, slug, color, folder_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, name, `${name}-${id.slice(0, 6)}`, 'violet', `/tmp/${id}`, now, now)
  return id
}

function message(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: randomUUID(),
    groupId: 'remote-1',
    seq: 1,
    authorId: 'user-1',
    kind: 'text',
    body: '안녕',
    replyTo: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    editedAt: null,
    deleted: false,
    author: { nickname: '나리', avatarColor: 'blue', avatarEmoji: '🌙' },
    ...overrides
  }
}

function member(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    groupId: 'remote-1',
    userId: 'user-1',
    role: 'member',
    joinedAt: '2026-08-06T00:00:00.000Z',
    nickname: '나리',
    avatarColor: 'blue',
    avatarEmoji: '🌙',
    ...overrides
  }
}

// The 10s default is not enough for the FIRST hook on this machine: it also
// pays the cold load of the better-sqlite3 native module, which is slow under
// the disk pressure documented in docs/environment-issues.md §1. Subsequent
// hooks run in single-digit milliseconds.
const DB_SETUP_TIMEOUT_MS = 30_000

beforeEach(() => {
  testDb = createTestDb()
  repo = createGroupRepo(testDb.db)
}, DB_SETUP_TIMEOUT_MS)

afterEach(() => {
  testDb.cleanup()
})

describe('migration 005', () => {
  test('creates every Phase-2 table without touching Phase-1 ones', () => {
    const names = (
      testDb.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name)

    for (const table of [
      'course_group_links',
      'group_messages_cache',
      'group_outbox',
      'group_profiles_cache',
      'group_members_cache'
    ]) {
      expect(names).toContain(table)
    }
    // The Phase-1 tables are untouched — the whole point of a mapping table.
    expect(names).toContain('courses')
    expect(names).toContain('materials_index')
  })

  test('records version 5 in the bookkeeping table', () => {
    const rows = testDb.db
      .prepare('SELECT version FROM migrations ORDER BY version')
      .all() as { version: number }[]
    // Asserts what this test's name claims — that migration 5 ran — rather
    // than the exact set, which every later migration would otherwise break.
    // tests/main/migrations.test.ts owns the full-list assertion.
    expect(rows.map((row) => row.version)).toContain(5)
  })
})

describe('course_group_links', () => {
  test('upsert creates a link with no course attached', () => {
    // `course_id` is nullable so joining by code stays a 2-step flow: you can
    // join first and attach the course later, or never (§5.2).
    const group = repo.upsertGroup({
      id: 'remote-1',
      name: '자료구조 3조',
      color: 'violet'
    })
    expect(group.courseId).toBeNull()
    expect(repo.listGroups()).toHaveLength(1)
  })

  test('list exposes null courseId so unassigned groups can be filtered', () => {
    const courseId = seedCourse()
    repo.upsertGroup({ id: 'remote-1', name: '미지정', color: 'violet' })
    repo.upsertGroup({ id: 'remote-2', name: '지정됨', color: 'blue', courseId })

    const unassigned = repo
      .listGroups()
      .filter((group) => group.courseId === null)

    expect(unassigned.map((group) => group.id)).toEqual(['remote-1'])
  })

  test('upsert is keyed by the remote group id, not a local id', () => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
    const second = repo.upsertGroup({ id: 'remote-1', name: 'B', color: 'blue' })
    expect(repo.listGroups()).toHaveLength(1)
    expect(second.name).toBe('B')
  })

  test('upsert without courseId does not silently unlink an attached group', () => {
    const courseId = seedCourse()
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
    repo.linkCourse('remote-1', courseId)
    const refreshed = repo.upsertGroup({
      id: 'remote-1',
      name: 'A renamed',
      color: 'gold'
    })
    expect(refreshed.courseId).toBe(courseId)
  })

  test('an explicit null DOES unlink', () => {
    const courseId = seedCourse()
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold', courseId })
    const unlinked = repo.upsertGroup({
      id: 'remote-1',
      name: 'A',
      color: 'gold',
      courseId: null
    })
    expect(unlinked.courseId).toBeNull()
  })

  test('one course can hold several groups (전체방 + 우리조)', () => {
    // This 1:N shape is exactly why the binding is a table and not a column.
    const courseId = seedCourse()
    repo.upsertGroup({ id: 'remote-1', name: '전체 공지', color: 'gold', courseId })
    repo.upsertGroup({ id: 'remote-2', name: '우리 3조', color: 'blue', courseId })
    const linked = repo.listGroups().filter((group) => group.courseId === courseId)
    expect(linked).toHaveLength(2)
  })

  test('linkCourse rejects an unknown course', () => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
    expect(() => repo.linkCourse('remote-1', 'nope')).toThrow()
  })

  test('linkCourse rejects an unknown group', () => {
    const courseId = seedCourse()
    expect(() => repo.linkCourse('missing', courseId)).toThrow()
  })

  test('setUnread updates the badge and clamps negatives to zero', () => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
    repo.setUnread('remote-1', 7, '2026-08-06T01:00:00.000Z')
    expect(repo.getGroup('remote-1')?.unread).toBe(7)
    repo.setUnread('remote-1', -3, null)
    expect(repo.getGroup('remote-1')?.unread).toBe(0)
  })

  test('removeGroup soft-deletes the link and drops its caches', () => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
    repo.upsertMessages([message({ seq: 1 })])
    repo.replaceMembers('remote-1', [member()])
    repo.enqueue({ groupId: 'remote-1', body: '대기 중' })

    repo.removeGroup('remote-1')

    expect(repo.getGroup('remote-1')).toBeNull()
    expect(repo.listGroups()).toHaveLength(0)
    expect(repo.tailMessages('remote-1', 50)).toHaveLength(0)
    expect(repo.listMembers('remote-1')).toHaveLength(0)
    expect(repo.pendingFor('remote-1')).toHaveLength(0)
  })

  test('rejoining a soft-deleted group revives it and preserves an omitted courseId', () => {
    const courseId = seedCourse()
    repo.upsertGroup({
      id: 'remote-1',
      name: '이전 이름',
      color: 'gold',
      courseId,
      memberCount: 2,
      unread: 1,
      lastMsgAt: '2026-08-01T00:00:00.000Z',
      joinedAt: '2026-08-01T00:00:00.000Z'
    })
    repo.removeGroup('remote-1')

    const rejoinedAt = '2026-08-07T00:00:00.000Z'
    expect(() =>
      repo.upsertGroup({
        id: 'remote-1',
        name: '새 이름',
        color: 'blue',
        memberCount: 5,
        unread: 3,
        lastMsgAt: '2026-08-07T01:00:00.000Z',
        joinedAt: rejoinedAt
      })
    ).not.toThrow()

    const stored = testDb.db
      .prepare(
        `SELECT course_id, name_cache, color_cache, member_count_cache,
                unread_cache, last_msg_at_cache, joined_at, deleted_at
           FROM course_group_links
          WHERE remote_group_id = ?`
      )
      .get('remote-1') as {
      course_id: string | null
      name_cache: string
      color_cache: string
      member_count_cache: number
      unread_cache: number
      last_msg_at_cache: string | null
      joined_at: string
      deleted_at: string | null
    }
    expect(stored).toEqual({
      course_id: courseId,
      name_cache: '새 이름',
      color_cache: 'blue',
      member_count_cache: 5,
      unread_cache: 3,
      last_msg_at_cache: '2026-08-07T01:00:00.000Z',
      joined_at: rejoinedAt,
      deleted_at: null
    })
    expect(repo.listGroups()).toEqual([
      expect.objectContaining({ id: 'remote-1', courseId, joinedAt: rejoinedAt })
    ])
  })

  test('rejoining with an explicit null courseId unlinks the revived group', () => {
    const courseId = seedCourse()
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold', courseId })
    repo.removeGroup('remote-1')

    const revived = repo.upsertGroup({
      id: 'remote-1',
      name: 'A',
      color: 'gold',
      courseId: null
    })

    expect(revived.courseId).toBeNull()
    expect(repo.listGroups()).toEqual([
      expect.objectContaining({ id: 'remote-1', courseId: null })
    ])
  })

  test('retainGroups drops links the server no longer reports', () => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
    repo.upsertGroup({ id: 'remote-2', name: 'B', color: 'blue' })
    repo.retainGroups(['remote-1'])
    expect(repo.listGroups().map((group) => group.id)).toEqual(['remote-1'])
  })

  test('list sorts by most recent activity', () => {
    repo.upsertGroup({
      id: 'remote-old',
      name: 'old',
      color: 'gold',
      lastMsgAt: '2026-08-01T00:00:00.000Z'
    })
    repo.upsertGroup({
      id: 'remote-new',
      name: 'new',
      color: 'blue',
      lastMsgAt: '2026-08-06T00:00:00.000Z'
    })
    repo.upsertGroup({ id: 'remote-quiet', name: 'quiet', color: 'pink' })
    const ids = repo.listGroups().map((group) => group.id)
    expect(ids[0]).toBe('remote-new')
    expect(ids[1]).toBe('remote-old')
    // Never-used groups sink to the bottom rather than to the top.
    expect(ids[2]).toBe('remote-quiet')
  })
})

describe('group_messages_cache', () => {
  beforeEach(() => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
  })

  test('tail returns oldest → newest even though it queries newest-first', () => {
    repo.upsertMessages([
      message({ id: 'a', seq: 1 }),
      message({ id: 'b', seq: 2 }),
      message({ id: 'c', seq: 3 })
    ])
    expect(repo.tailMessages('remote-1', 2).map((entry) => entry.id)).toEqual([
      'b',
      'c'
    ])
  })

  test('upsert is idempotent on the client-generated id', () => {
    const row = message({ id: 'a', seq: 1 })
    repo.upsertMessages([row, row])
    expect(repo.tailMessages('remote-1', 50)).toHaveLength(1)
  })

  test('upsert preserves the author profile so the tail renders offline', () => {
    repo.upsertMessages([message({ id: 'a', seq: 1 })])
    expect(repo.tailMessages('remote-1', 50)[0]?.author.nickname).toBe('나리')
  })

  test('a deleted message round-trips with a null body', () => {
    repo.upsertMessages([message({ id: 'a', seq: 1 })])
    repo.markMessageDeleted('a', null, true)
    const [row] = repo.tailMessages('remote-1', 50)
    expect(row?.deleted).toBe(true)
    expect(row?.body).toBeNull()
  })

  test('messagesBefore is keyset, not offset', () => {
    repo.upsertMessages([
      message({ id: 'a', seq: 1 }),
      message({ id: 'b', seq: 2 }),
      message({ id: 'c', seq: 3 })
    ])
    expect(
      repo.messagesBefore('remote-1', 3, 10).map((entry) => entry.id)
    ).toEqual(['a', 'b'])
  })

  test('maxSeq is the reconnect catch-up cursor', () => {
    expect(repo.maxSeq('remote-1')).toBe(0)
    repo.upsertMessages([message({ id: 'a', seq: 5 })])
    expect(repo.maxSeq('remote-1')).toBe(5)
  })

  test('trimCache keeps only the newest N rows', () => {
    repo.upsertMessages(
      Array.from({ length: 10 }, (_, index) =>
        message({ id: `m${index}`, seq: index + 1 })
      )
    )
    repo.trimCache('remote-1', 3)
    const kept = repo.tailMessages('remote-1', 50)
    expect(kept).toHaveLength(3)
    expect(kept.map((entry) => entry.seq)).toEqual([8, 9, 10])
  })
})

describe('group_outbox', () => {
  beforeEach(() => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
  })

  test('enqueue creates a pending row with a client-generated id', () => {
    const row = repo.enqueue({ groupId: 'remote-1', body: '보낼 것' })
    expect(row.state).toBe('pending')
    expect(row.attempts).toBe(0)
    // That id BECOMES the remote messages.id, which is what makes retries
    // idempotent (§4.4).
    expect(row.localId).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('enqueue rejects an empty or oversized body', () => {
    expect(() => repo.enqueue({ groupId: 'remote-1', body: '   ' })).toThrow()
    expect(() =>
      repo.enqueue({ groupId: 'remote-1', body: 'x'.repeat(4001) })
    ).toThrow()
  })

  test('claimable only returns rows whose backoff has elapsed', () => {
    const row = repo.enqueue({ groupId: 'remote-1', body: 'x' })
    repo.markRetry(row.localId, 'network', '2099-01-01T00:00:00.000Z')
    expect(repo.claimable('2026-08-06T00:00:00.000Z')).toHaveLength(0)
    expect(repo.claimable('2100-01-01T00:00:00.000Z')).toHaveLength(1)
  })

  test('markSent removes the row (the real one returns via broadcast)', () => {
    const row = repo.enqueue({ groupId: 'remote-1', body: 'x' })
    repo.markSent(row.localId)
    expect(repo.pendingFor('remote-1')).toHaveLength(0)
  })

  test('markRetry increments attempts and keeps the row pending', () => {
    const row = repo.enqueue({ groupId: 'remote-1', body: 'x' })
    const after = repo.markRetry(row.localId, 'network', '2026-08-06T00:00:01.000Z')
    expect(after?.attempts).toBe(1)
    expect(after?.state).toBe('pending')
    expect(after?.lastError).toBe('network')
  })

  test('a failed send survives an app restart', () => {
    // The outbox is a table precisely so the 빨간 느낌표 is still there
    // tomorrow — the same contract KakaoTalk offers.
    const row = repo.enqueue({ groupId: 'remote-1', body: '중요' })
    repo.markFailed(row.localId, 'rejected')
    const reopened = createGroupRepo(testDb.db)
    const [restored] = reopened.pendingFor('remote-1')
    expect(restored?.state).toBe('failed')
    expect(restored?.body).toBe('중요')
  })

  test('requeue resets attempts so 다시 시도 gets a full budget', () => {
    const row = repo.enqueue({ groupId: 'remote-1', body: 'x' })
    repo.markRetry(row.localId, 'network', '2026-08-06T00:00:01.000Z')
    repo.markFailed(row.localId, 'network')
    const requeued = repo.requeue(row.localId)
    expect(requeued?.state).toBe('pending')
    expect(requeued?.attempts).toBe(0)
    expect(requeued?.lastError).toBeNull()
  })

  test('releaseStranded rescues rows left in sending by a crash', () => {
    const row = repo.enqueue({ groupId: 'remote-1', body: 'x' })
    repo.markSending(row.localId)
    expect(repo.claimable('2100-01-01T00:00:00.000Z')).toHaveLength(0)
    repo.releaseStranded()
    expect(repo.claimable('2100-01-01T00:00:00.000Z')).toHaveLength(1)
  })
})

describe('profile and member caches', () => {
  beforeEach(() => {
    repo.upsertGroup({ id: 'remote-1', name: 'A', color: 'gold' })
  })

  test('replaceMembers joins profiles and orders owner → admin → member', () => {
    repo.replaceMembers('remote-1', [
      member({ userId: 'u3', role: 'member', nickname: '별이' }),
      member({ userId: 'u1', role: 'owner', nickname: '나리' }),
      member({ userId: 'u2', role: 'admin', nickname: '달기' })
    ])
    expect(repo.listMembers('remote-1').map((entry) => entry.userId)).toEqual([
      'u1',
      'u2',
      'u3'
    ])
    expect(repo.listMembers('remote-1')[0]?.nickname).toBe('나리')
  })

  test('replaceMembers is a replacement, not a merge', () => {
    repo.replaceMembers('remote-1', [member({ userId: 'u1' }), member({ userId: 'u2' })])
    repo.replaceMembers('remote-1', [member({ userId: 'u1' })])
    expect(repo.listMembers('remote-1')).toHaveLength(1)
  })

  test('searchProfiles powers offline prefix autocomplete', () => {
    // Prefix matching lives HERE and never on the server: an exposed prefix
    // search would let anyone scrape the nickname directory (§5.3).
    repo.upsertProfiles([
      member({ userId: 'u1', nickname: '나리' }),
      member({ userId: 'u2', nickname: '나무' }),
      member({ userId: 'u3', nickname: '달기' })
    ])
    expect(repo.searchProfiles('나').map((entry) => entry.nickname).sort()).toEqual(
      ['나리', '나무']
    )
    expect(repo.searchProfiles('')).toHaveLength(0)
  })

  test('searchProfiles escapes LIKE wildcards instead of matching everything', () => {
    repo.upsertProfiles([member({ userId: 'u1', nickname: '나리' })])
    expect(repo.searchProfiles('%')).toHaveLength(0)
    expect(repo.searchProfiles('_')).toHaveLength(0)
  })

  test('clearAll wipes every Phase-2 cache on sign-out', () => {
    // The cache is per-account; leaving it behind leaks one student's group
    // names into the next sign-in on a shared laptop.
    repo.upsertMessages([message({ seq: 1 })])
    repo.replaceMembers('remote-1', [member()])
    repo.enqueue({ groupId: 'remote-1', body: 'x' })
    repo.clearAll()
    expect(repo.listGroups()).toHaveLength(0)
    expect(repo.tailMessages('remote-1', 50)).toHaveLength(0)
    expect(repo.listMembers('remote-1')).toHaveLength(0)
    expect(repo.pendingFor('remote-1')).toHaveLength(0)
    expect(repo.searchProfiles('나')).toHaveLength(0)
  })
})
