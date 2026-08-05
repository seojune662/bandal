import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Course, CreateCourseInput } from '../../../shared/types/course'
import { invoke } from '../lib/ipc'

interface CoursesState {
  courses: Course[]
  selectedCourseId: string | null
  isLoading: boolean
  pendingCourseId: string | null
  error: string | null
  loadCourses: () => Promise<void>
  selectCourse: (courseId: string) => void
  createCourse: (input: CreateCourseInput) => Promise<Course>
  renameCourse: (courseId: string, name: string) => Promise<Course>
  archiveCourse: (courseId: string) => Promise<void>
  deleteCourse: (courseId: string) => Promise<void>
  clearError: () => void
}

let loadSequence = 0

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'
}

function nextSelection(courses: Course[], removedId: string): string | null {
  const removedIndex = courses.findIndex((course) => course.id === removedId)
  const remaining = courses.filter((course) => course.id !== removedId)
  if (remaining.length === 0) return null
  const nextIndex = Math.min(Math.max(removedIndex, 0), remaining.length - 1)
  return remaining[nextIndex]?.id ?? null
}

export const useCoursesStore = create<CoursesState>()(
  immer((set, get) => ({
    courses: [],
    selectedCourseId: null,
    isLoading: false,
    pendingCourseId: null,
    error: null,

    loadCourses: async () => {
      const sequence = ++loadSequence
      set((state) => {
        state.isLoading = true
        state.error = null
      })

      try {
        const courses = await invoke('courses:list', {})
        if (sequence !== loadSequence) return
        set((state) => {
          state.courses = courses
          const selectionStillExists = courses.some(
            (course) => course.id === state.selectedCourseId
          )
          if (!selectionStillExists) state.selectedCourseId = courses[0]?.id ?? null
          state.isLoading = false
        })
      } catch (error) {
        if (sequence !== loadSequence) return
        set((state) => {
          state.isLoading = false
          state.error = errorMessage(error)
        })
      }
    },

    selectCourse: (courseId) => {
      if (!get().courses.some((course) => course.id === courseId)) return
      set((state) => {
        state.selectedCourseId = courseId
      })
    },

    createCourse: async (input) => {
      set((state) => {
        state.error = null
      })
      try {
        const created = await invoke('courses:create', input)
        set((state) => {
          state.courses.push(created)
          state.courses.sort((a, b) => a.sortOrder - b.sortOrder)
          state.selectedCourseId = created.id
        })
        return created
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    renameCourse: async (courseId, name) => {
      set((state) => {
        state.pendingCourseId = courseId
        state.error = null
      })
      try {
        const renamed = await invoke('courses:rename', { courseId, name })
        set((state) => {
          const index = state.courses.findIndex((course) => course.id === courseId)
          if (index !== -1) state.courses[index] = renamed
          state.pendingCourseId = null
        })
        return renamed
      } catch (error) {
        set((state) => {
          state.pendingCourseId = null
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    archiveCourse: async (courseId) => {
      const { courses, selectedCourseId } = get()
      set((state) => {
        state.pendingCourseId = courseId
        state.error = null
      })
      try {
        await invoke('courses:archive', { courseId, archived: true })
        set((state) => {
          state.courses = state.courses.filter((course) => course.id !== courseId)
          if (selectedCourseId === courseId) {
            state.selectedCourseId = nextSelection(courses, courseId)
          }
          state.pendingCourseId = null
        })
      } catch (error) {
        set((state) => {
          state.pendingCourseId = null
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    deleteCourse: async (courseId) => {
      const { courses, selectedCourseId } = get()
      set((state) => {
        state.pendingCourseId = courseId
        state.error = null
      })
      try {
        await invoke('courses:delete', { courseId })
        set((state) => {
          state.courses = state.courses.filter((course) => course.id !== courseId)
          if (selectedCourseId === courseId) {
            state.selectedCourseId = nextSelection(courses, courseId)
          }
          state.pendingCourseId = null
        })
      } catch (error) {
        set((state) => {
          state.pendingCourseId = null
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    clearError: () => {
      set((state) => {
        state.error = null
      })
    }
  }))
)
