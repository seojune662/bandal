import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Favorite } from '../../../src/shared/types/favorite'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  favoriteScopeKey,
  resetFavoritesStoreForTests,
  useFavoritesStore
} from '../../../src/renderer/src/stores/favoritesStore'

const invokeMock = vi.mocked(invoke)

function favorite(
  id: string,
  courseId: string | null,
  label: string,
  sortOrder: number
): Favorite {
  return {
    id,
    courseId,
    label,
    descriptor: { kind: 'board', payload: {} },
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

beforeEach(() => {
  resetFavoritesStoreForTests()
  invokeMock.mockReset()
})

describe('favoritesStore', () => {
  test('loads course and global scopes independently', async () => {
    invokeMock.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'favorites:list') {
        const courseId = (request as { courseId: string | null }).courseId
        return Promise.resolve([
          favorite(courseId === null ? 'global' : 'course', courseId, '보드', 0)
        ])
      }
      return Promise.resolve({ ok: true })
    })

    await useFavoritesStore.getState().load('c1')
    await useFavoritesStore.getState().load(null)

    expect(useFavoritesStore.getState().byCourse[favoriteScopeKey('c1')]).toHaveLength(1)
    expect(useFavoritesStore.getState().byCourse[favoriteScopeKey(null)]?.[0]?.id)
      .toBe('global')
  })

  test('adds, renames, and removes favorites through typed IPC', async () => {
    const original = favorite('a', 'c1', '보드', 0)
    invokeMock.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'favorites:list') return Promise.resolve([original])
      if (channel === 'favorites:add') return Promise.resolve(favorite('b', 'c1', 'AI', 1))
      if (channel === 'favorites:rename') {
        return Promise.resolve({
          ...original,
          label: (request as { label: string }).label
        })
      }
      return Promise.resolve({ ok: true })
    })
    const store = useFavoritesStore.getState()
    await store.load('c1')

    await useFavoritesStore.getState().add({
      courseId: 'c1',
      label: 'AI',
      descriptor: { kind: 'chat', payload: { courseId: 'c1' } }
    })
    await useFavoritesStore.getState().rename({ id: 'a', label: '새 보드' })
    await useFavoritesStore.getState().remove('b')

    expect(
      useFavoritesStore.getState().byCourse[favoriteScopeKey('c1')]?.map((item) => item.label)
    ).toEqual(['새 보드'])
    expect(invokeMock).toHaveBeenCalledWith('favorites:remove', { id: 'b' })
  })

  test('optimistically reorders the complete list and sends its scope', async () => {
    const first = favorite('a', 'c1', 'A', 0)
    const second = favorite('b', 'c1', 'B', 1)
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'favorites:list') return Promise.resolve([first, second])
      return Promise.resolve({ ok: true })
    })
    await useFavoritesStore.getState().load('c1')

    await useFavoritesStore.getState().reorder(['b', 'a'])

    const reordered = useFavoritesStore.getState().byCourse[favoriteScopeKey('c1')]
    expect(reordered?.map((item) => [item.id, item.sortOrder])).toEqual([
      ['b', 0],
      ['a', 1]
    ])
    expect(invokeMock).toHaveBeenCalledWith('favorites:reorder', {
      courseId: 'c1',
      ids: ['b', 'a']
    })
  })

  test('rolls an optimistic reorder back when IPC rejects it', async () => {
    const first = favorite('a', 'c1', 'A', 0)
    const second = favorite('b', 'c1', 'B', 1)
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'favorites:list') return Promise.resolve([first, second])
      if (channel === 'favorites:reorder') return Promise.reject(new Error('offline'))
      return Promise.resolve({ ok: true })
    })
    await useFavoritesStore.getState().load('c1')

    await expect(useFavoritesStore.getState().reorder(['b', 'a'])).rejects.toThrow(
      'offline'
    )

    expect(
      useFavoritesStore.getState().byCourse[favoriteScopeKey('c1')]?.map((item) => item.id)
    ).toEqual(['a', 'b'])
    expect(useFavoritesStore.getState().error).toBe('offline')
  })
})

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('a stale list response cannot remove a newly added favorite', async () => {
  const old = favorite('old', 'c1', 'Old', 0), added = favorite('new', 'c1', 'New', 1)
  useFavoritesStore.setState({ byCourse: { c1: [old] } })
  const listing = deferred<Favorite[]>()
  invokeMock.mockImplementation(channel => channel === 'favorites:list' ? listing.promise : Promise.resolve(added))
  const loading = useFavoritesStore.getState().load('c1')
  await useFavoritesStore.getState().add({ courseId: 'c1', label: 'New', descriptor: added.descriptor })
  listing.resolve([old]); await loading
  expect(useFavoritesStore.getState().byCourse.c1?.map(item => item.id)).toEqual(['old', 'new'])
  expect(useFavoritesStore.getState().loadingByCourse.c1).toBe(false)
})

test('a failed remove restores only its item and preserves a concurrent add and rename', async () => {
  const removed = favorite('a', 'c1', 'A', 0), keep = favorite('b', 'c1', 'B', 1), added = favorite('c', 'c1', 'C', 2)
  useFavoritesStore.setState({ byCourse: { c1: [removed, keep] } })
  const deletion = deferred<{ ok: true }>()
  invokeMock.mockImplementation(channel => channel === 'favorites:remove' ? deletion.promise : Promise.resolve(channel === 'favorites:rename' ? { ...keep, label: 'Changed' } : added))
  const pending = useFavoritesStore.getState().remove('a')
  const rejected = expect(pending).rejects.toThrow('failed')
  await useFavoritesStore.getState().add({ courseId: 'c1', label: 'C', descriptor: added.descriptor })
  await useFavoritesStore.getState().rename({ id: 'b', label: 'Changed' })
  deletion.reject(new Error('failed')); await rejected
  expect(useFavoritesStore.getState().byCourse.c1?.map(item => [item.id, item.label])).toEqual([['a', 'A'], ['b', 'Changed'], ['c', 'C']])
})

test('an older failed reorder cannot undo a newer successful order', async () => {
  useFavoritesStore.setState({ byCourse: { c1: ['a', 'b', 'c'].map((id, n) => favorite(id, 'c1', id, n)) } })
  const first = deferred<{ ok: true }>()
  invokeMock.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true })
  const old = useFavoritesStore.getState().reorder(['b', 'a', 'c'])
  const rejected = expect(old).rejects.toThrow('failed')
  await useFavoritesStore.getState().reorder(['c', 'b', 'a'])
  first.reject(new Error('failed')); await rejected
  expect(useFavoritesStore.getState().byCourse.c1?.map(item => item.id)).toEqual(['c', 'b', 'a'])
})

test('a completed add does not duplicate an item already included by a list refresh', async () => {
  const added = favorite('new', 'c1', 'New', 0)
  useFavoritesStore.setState({ byCourse: { c1: [added] } })
  invokeMock.mockResolvedValue(added)
  await useFavoritesStore.getState().add({ courseId: 'c1', label: 'New', descriptor: added.descriptor })
  expect(useFavoritesStore.getState().byCourse.c1).toEqual([added])
})
