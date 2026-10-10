import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Favorite, CreateFavoriteInput } from '../../../src/shared/types/favorite'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn(() => () => {}), openSettingsWindow: vi.fn() }))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import { favoriteScopeKey, resetFavoritesStoreForTests, useFavoritesStore } from '../../../src/renderer/src/stores/favoritesStore'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { resetBrowserGuestsForTests, useBrowserGuests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { toggleFavorite } from '../../../src/renderer/src/features/browser/browserFavorite'

const invokeMock = vi.mocked(invoke)
const nav = { url: 'https://school.example/lecture', title: 'Lecture', loading: false, canGoBack: false, canGoForward: false }
function favorite(id: string, profileId?: string, courseId: string | null = 'course'): Favorite {
  return { id, courseId, label: 'Saved', descriptor: { kind: 'browser', payload: { tabId: `${id}-tab`, initialUrl: nav.url, ...(profileId === undefined ? {} : { profileId }) } }, sortOrder: 0, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
}
beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel: string, request: unknown) => channel === 'favorites:add' ? { ...favorite('created'), ...request as CreateFavoriteInput } : { ok: true })
  resetFavoritesStoreForTests()
  resetBrowserGuestsForTests()
  useWorkspaceStore.setState({ activeCourseId: 'course' })
  useFavoritesStore.setState({ byCourse: { [favoriteScopeKey('course')]: [], [favoriteScopeKey(null)]: [] } })
  useBrowserGuests.setState({ liveGuests: [{ tabId: 'active-tab', src: nav.url, profileId: 'school', isPrivate: false, courseId: 'course' }] })
})

describe('profile-aware browser favorites', () => {
  test('repeated clicks cannot duplicate a pending save or re-add a pending removal', async () => {
    let complete!: (value: unknown) => void
    invokeMock.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    toggleFavorite('active-tab', nav)
    toggleFavorite('active-tab', nav)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    complete(favorite('created', 'school'))
    await vi.waitFor(() => expect(useFavoritesStore.getState().byCourse.course).toHaveLength(1))
    toggleFavorite('active-tab', nav)
    toggleFavorite('active-tab', nav)
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenLastCalledWith('favorites:remove', { id: 'created' })
    complete({ ok: true })
    await vi.waitFor(() => expect(useFavoritesStore.getState().byCourse.course).toHaveLength(0))
  })

  test('disambiguates generic page titles and saves under the guest course, even when another course is active', async () => {
    useWorkspaceStore.setState({ activeCourseId: 'another-course' })
    toggleFavorite('active-tab', { ...nav, title: '마이페이지' })
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('favorites:add', expect.objectContaining({ courseId: 'course', label: 'school.example · 마이페이지' })))
  })

  test('global guest ownership remains global while a course is selected', async () => {
    useBrowserGuests.setState({ liveGuests: [{ tabId: 'active-tab', src: nav.url, profileId: 'school', isPrivate: false, courseId: null }] })
    toggleFavorite('active-tab', nav)
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('favorites:add', expect.objectContaining({ courseId: null })))
  })

  test('saving from a named profile keeps the course and profile and never removes another account bookmark', async () => {
    useFavoritesStore.setState({ byCourse: { [favoriteScopeKey('course')]: [favorite('personal')], [favoriteScopeKey(null)]: [] } })
    toggleFavorite('active-tab', nav)
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('favorites:add', { courseId: 'course', label: 'Lecture', descriptor: { kind: 'browser', payload: { tabId: 'active-tab', initialUrl: nav.url, profileId: 'school' } } }))
    expect(invokeMock).not.toHaveBeenCalledWith('favorites:remove', expect.anything())
  })

  test('an imported global bookmark is matched and removed without creating a duplicate course pin', async () => {
    useFavoritesStore.setState({ byCourse: { [favoriteScopeKey('course')]: [], [favoriteScopeKey(null)]: [favorite('imported', 'school', null)] } })
    toggleFavorite('active-tab', nav)
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('favorites:remove', { id: 'imported' }))
    expect(invokeMock).not.toHaveBeenCalledWith('favorites:add', expect.anything())
  })

  test('legacy favorites still match the default profile', async () => {
    useBrowserGuests.setState({ liveGuests: [{ tabId: 'active-tab', src: nav.url, profileId: 'default', isPrivate: false, courseId: 'course' }] })
    useFavoritesStore.setState({ byCourse: { [favoriteScopeKey('course')]: [favorite('legacy')], [favoriteScopeKey(null)]: [favorite('school-global', 'school', null)] } })
    toggleFavorite('active-tab', nav)
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('favorites:remove', { id: 'legacy' }))
    expect(useFavoritesStore.getState().byCourse[favoriteScopeKey(null)]?.[0]?.id).toBe('school-global')
  })
})
