import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  AddCourseFromFolderInput,
  Course,
  CourseFolderResult,
  CreateCourseInput,
  PickedFolder
} from '../../../shared/types/course'
import { folderProblemMessage } from '../features/courses/folderMessages'
import { invoke } from '../lib/ipc'
import type { ImmerStore } from './immerStore'
import { useWorkspaceStore } from './workspaceStore'

interface CoursesState {
  courses: Course[]
  selectedCourseId: string | null
  isLoading: boolean
  pendingCourseId: string | null
  error: string | null
  loadCourses: () => Promise<void>
  selectCourse: (courseId: string) => void
  createCourse: (input: CreateCourseInput) => Promise<Course>
  /** Opens the native folder picker; resolves to null when cancelled. */
  pickFolder: () => Promise<PickedFolder | null>
  /** Registers an existing folder as a course (or focuses the duplicate). */
  addCourseFromFolder: (input: AddCourseFromFolderInput) => Promise<CourseFolderResult>
  /** Repoints a 연결 끊김 course at another folder. */
  relinkCourse: (courseId: string, folderPath: string) => Promise<CourseFolderResult>
  renameCourse: (courseId: string, name: string) => Promise<Course>
  archiveCourse: (courseId: string, archived: boolean) => Promise<void>
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

export const useCoursesStore: ImmerStore<CoursesState> = create<CoursesState>()(
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

    pickFolder: async () => {
      set((state) => {
        state.error = null
      })
      try {
        return await invoke('courses:pickFolder', {})
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    addCourseFromFolder: async (input) => {
      set((state) => {
        state.error = null
      })
      try {
        const result = await invoke('courses:addFromFolder', input)
        if (result.status === 'failed') {
          set((state) => {
            state.error = folderProblemMessage(result.reason)
          })
          return result
        }
        const course = result.course
        set((state) => {
          const index = state.courses.findIndex((item) => item.id === course.id)
          if (index === -1) {
            state.courses.push(course)
          } else {
            state.courses[index] = course
          }
          state.courses.sort((a, b) => a.sortOrder - b.sortOrder)
          state.selectedCourseId = course.id
        })
        return result
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    relinkCourse: async (courseId, folderPath) => {
      set((state) => {
        state.pendingCourseId = courseId
        state.error = null
      })
      try {
        const result = await invoke('courses:relink', { courseId, folderPath })
        set((state) => {
          state.pendingCourseId = null
          if (result.status === 'failed') {
            state.error = folderProblemMessage(result.reason)
            return
          }
          const course = result.course
          const index = state.courses.findIndex((item) => item.id === course.id)
          if (index === -1) {
            state.courses.push(course)
            state.courses.sort((a, b) => a.sortOrder - b.sortOrder)
          } else {
            state.courses[index] = course
          }
          if (result.status === 'duplicate') {
            state.error = '그 폴더는 이미 다른 과목이 쓰고 있어요.'
          }
          state.selectedCourseId = course.id
        })
        return result
      } catch (error) {
        set((state) => {
          state.pendingCourseId = null
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

    archiveCourse: async (courseId, archived) => {
      const { courses, selectedCourseId } = get()
      set((state) => {
        state.pendingCourseId = courseId
        state.error = null
      })
      try {
        const updated = await invoke('courses:archive', { courseId, archived })
        if (archived) {
          // The course row is gone from active listings; a queued layout save
          // for it would be stale. Its agent session was disposed in main.
          useWorkspaceStore.getState().discardPendingSave(courseId)
        }
        set((state) => {
          if (archived) {
            state.courses = state.courses.filter((course) => course.id !== courseId)
            if (selectedCourseId === courseId) {
              state.selectedCourseId = nextSelection(courses, courseId)
            }
          } else {
            const index = state.courses.findIndex((course) => course.id === courseId)
            if (index === -1) state.courses.push(updated)
            else state.courses[index] = updated
            state.courses.sort((a, b) => a.sortOrder - b.sortOrder)
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
        // Saving a layout for a deleted course would throw in main; the
        // workspace swaps to the next course via the selection change below.
        useWorkspaceStore.getState().discardPendingSave(courseId)
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
