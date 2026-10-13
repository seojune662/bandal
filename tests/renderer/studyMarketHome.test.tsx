// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StudyMarketDashboard } from '../../src/shared/types/studyMarket'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useUniversityStore } from '../../src/renderer/src/stores/universityStore'
import { useCoursesStore } from '../../src/renderer/src/stores/coursesStore'
import { findUniversity } from '../../src/shared/universities'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../src/renderer/src/features/studyMarket/api', () => ({ marketRequest: mocks.request, readCourseBindings: () => ({}), saveCourseBinding: vi.fn() }))
import StudyMarketHome from '../../src/renderer/src/features/studyMarket/StudyMarketHome'

const context = { universities: [{ id: 'snu', name: '서울대학교' }, { id: 'yonsei', name: '연세대학교' }], tradingEnabled: false, notice: '' }
const dashboard: StudyMarketDashboard = { configured: true, tradingEnabled: false, signedIn: true, operator: true, seller: { status: 'ready', displayName: '판매자' }, listings: [], purchases: [], payouts: [], salesCount: 0, pendingAmount: 0, paidAmount: 0, notice: '' }

describe('market school and account request ordering', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    useAuthStore.setState({ auth: { phase: 'signed-in', profile: { id: 'buyer', nickname: '학생', avatarColor: '', avatarEmoji: '' }, email: null, avatarUrl: null, online: true, errorCode: null }, init: async () => {} })
    useUniversityStore.setState({ university: findUniversity('snu'), init: async () => {} })
    useCoursesStore.setState({ courses: [], loadCourses: async () => {} })
    mocks.request.mockImplementation(async (action: string) => action === 'context' ? context : action === 'dashboard' ? dashboard : action === 'courses' ? [] : { listings: [], nextCursor: null })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  test('waits for the selected school membership before requesting its catalog', async () => {
    let resolveSchool!: (value: typeof context) => void
    mocks.request.mockImplementation(async (action: string, input: { universityId?: string }) => {
      if (action === 'context' && input.universityId) return new Promise<typeof context>(resolve => { resolveSchool = resolve })
      if (action === 'context') return context
      if (action === 'dashboard') return dashboard
      if (action === 'courses') return []
      return { listings: [], nextCursor: null }
    })
    await act(async () => root.render(<StudyMarketHome />))
    expect(mocks.request).toHaveBeenCalledWith('context', { universityId: 'snu' })
    expect(mocks.request).not.toHaveBeenCalledWith('courses', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('listings', expect.anything())
    await act(async () => resolveSchool(context))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(mocks.request).toHaveBeenCalledWith('courses', { universityId: 'snu' })
    expect(mocks.request).toHaveBeenCalledWith('listings', expect.objectContaining({ universityId: 'snu' }))
  })
  test('does not restore the previous account operator dashboard after sign-out', async () => {
    let resolveDashboard!: (value: StudyMarketDashboard) => void
    mocks.request.mockImplementation(async (action: string) => {
      if (action === 'dashboard') return new Promise<StudyMarketDashboard>(resolve => { resolveDashboard = resolve })
      if (action === 'context') return context
      if (action === 'courses') return []
      return { listings: [], nextCursor: null }
    })
    await act(async () => root.render(<StudyMarketHome />))
    await act(async () => useAuthStore.setState({ auth: { ...useAuthStore.getState().auth, phase: 'signed-out', profile: null } }))
    await act(async () => resolveDashboard(dashboard))
    expect(Array.from(container.querySelectorAll('nav button')).some(button => button.textContent === '운영')).toBe(false)
  })
  test('follows changes to the app university instead of keeping a stale market school', async () => {
    await act(async () => root.render(<StudyMarketHome />))
    await act(async () => useUniversityStore.setState({ university: findUniversity('yonsei') }))
    expect(mocks.request).toHaveBeenCalledWith('context', { universityId: 'yonsei' })
    expect(container.querySelector('.study-market__school-button')?.textContent).toContain('연세대학교')
  })
})
