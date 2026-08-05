/**
 * [M8] Per-course shortcuts, keyed by course id.
 *
 * Kept separate from `coursesStore` because links load lazily: only the
 * selected course's links are ever fetched, and a course with none costs
 * nothing.
 */

import { create } from 'zustand'
import type { CourseLink } from '../../../shared/types/courseLink'
import type { CourseLinkSpec } from '../../../shared/types/university'
import {
  defaultCourseLinkLabel,
  parseCourseUrl,
  type CourseUrlParse
} from '../../../shared/universities'
import { invoke } from '../lib/ipc'

interface CourseLinksStore {
  /** courseId → links, in sidebar order. Absent = not loaded yet. */
  byCourse: Record<string, CourseLink[]>
  pendingCourseId: string | null
  error: string | null
  load: (courseId: string) => Promise<void>
  /**
   * Classifies a pasted URL with the school's spec and stores it.
   * Returns the parse so the caller can surface "강의실로 인식했어요".
   */
  addFromUrl: (input: {
    courseId: string
    rawUrl: string
    label?: string
    spec: CourseLinkSpec | null
  }) => Promise<CourseUrlParse>
  rename: (id: string, courseId: string, label: string) => Promise<void>
  remove: (id: string, courseId: string) => Promise<void>
  clearError: () => void
}

export const useCourseLinksStore = create<CourseLinksStore>()((set, get) => ({
  byCourse: {},
  pendingCourseId: null,
  error: null,

  load: async (courseId) => {
    try {
      const links = await invoke('courseLinks:list', { courseId })
      set((state) => ({ byCourse: { ...state.byCourse, [courseId]: links } }))
    } catch (error) {
      console.error('[Bandal] 과목 링크를 불러오지 못했습니다.', error)
      set({ error: '과목 링크를 불러오지 못했어요.' })
    }
  },

  addFromUrl: async ({ courseId, rawUrl, label, spec }) => {
    const parse = parseCourseUrl(rawUrl, spec)
    if (parse.status === 'invalid') return parse

    const resolvedLabel =
      label !== undefined && label.trim().length > 0
        ? label.trim()
        : defaultCourseLinkLabel(parse)

    set({ pendingCourseId: courseId, error: null })
    try {
      const created = await invoke('courseLinks:create', {
        courseId,
        label: resolvedLabel,
        rawUrl: parse.rawUrl,
        url: parse.url,
        kind: parse.status === 'lms-course' ? 'lms-course' : 'other',
        lmsCourseId: parse.status === 'lms-course' ? parse.lmsCourseId : null
      })
      set((state) => ({
        byCourse: {
          ...state.byCourse,
          [courseId]: [...(state.byCourse[courseId] ?? []), created]
        }
      }))
      return parse
    } catch (error) {
      console.error('[Bandal] 과목 링크를 저장하지 못했습니다.', error)
      set({ error: '링크를 저장하지 못했어요. 잠시 후 다시 시도해주세요.' })
      throw error
    } finally {
      set({ pendingCourseId: null })
    }
  },

  rename: async (id, courseId, label) => {
    try {
      const updated = await invoke('courseLinks:update', { id, label })
      set((state) => ({
        byCourse: {
          ...state.byCourse,
          [courseId]: (state.byCourse[courseId] ?? []).map((link) =>
            link.id === id ? updated : link
          )
        }
      }))
    } catch (error) {
      console.error('[Bandal] 링크 이름을 바꾸지 못했습니다.', error)
      set({ error: '링크 이름을 바꾸지 못했어요.' })
    }
  },

  remove: async (id, courseId) => {
    // Optimistic: a shortcut removal that snaps back is more confusing than
    // a rare error toast, and the row is trivially re-addable.
    const previous = get().byCourse[courseId] ?? []
    set((state) => ({
      byCourse: {
        ...state.byCourse,
        [courseId]: previous.filter((link) => link.id !== id)
      }
    }))
    try {
      await invoke('courseLinks:delete', { id })
    } catch (error) {
      console.error('[Bandal] 링크를 삭제하지 못했습니다.', error)
      set((state) => ({
        byCourse: { ...state.byCourse, [courseId]: previous },
        error: '링크를 삭제하지 못했어요.'
      }))
    }
  },

  clearError: () => {
    set({ error: null })
  }
}))

/** Test-only reset. */
export function resetCourseLinksStoreForTests(): void {
  useCourseLinksStore.setState({
    byCourse: {},
    pendingCourseId: null,
    error: null
  })
}
