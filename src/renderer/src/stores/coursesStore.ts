import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  AddCourseFromFolderInput,
  Course,
  CourseFolderResult,
  CourseGroup,
  CreateCourseInput,
  PickedFolder
} from '../../../shared/types/course'
import { folderProblemMessage } from '../features/courses/folderMessages'
import { invoke } from '../lib/ipc'
import type { ImmerStore } from './immerStore'
import { useWorkspaceStore } from './workspaceStore'

interface CoursesState {
  courses: Course[]
  /** 과목 그룹(학기) — 사이드바 섹션. loadCourses 가 함께 채운다. */
  groups: CourseGroup[]
  selectedCourseId: string | null
  isLoading: boolean
  pendingCourseId: string | null
  error: string | null
  loadCourses: () => Promise<void>
  selectCourse: (courseId: string) => void
  createGroup: (name: string) => Promise<CourseGroup>
  renameGroup: (groupId: string, name: string) => Promise<CourseGroup>
  /** 그룹만 지운다 — 멤버 과목은 그룹 해제될 뿐 삭제되지 않는다. */
  deleteGroup: (groupId: string) => Promise<void>
  /** 한 번의 드래그 = 소속 + 위치 원자 반영. 서버가 준 목록으로 교체한다. */
  organizeCourse: (
    courseId: string,
    groupId: string | null,
    beforeCourseId: string | null
  ) => Promise<void>
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
    groups: [],
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
        // 그룹 목록은 과목 목록과 항상 짝으로 그려지므로 병렬로 함께 당긴다.
        const [courses, groups] = await Promise.all([
          invoke('courses:list', {}),
          invoke('courseGroups:list', {})
        ])
        if (sequence !== loadSequence) return
        set((state) => {
          state.courses = courses
          state.groups = groups
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

    createGroup: async (name) => {
      set((state) => {
        state.error = null
      })
      try {
        const created = await invoke('courseGroups:create', { name })
        set((state) => {
          state.groups.push(created)
          state.groups.sort((a, b) => a.sortOrder - b.sortOrder)
        })
        return created
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    renameGroup: async (groupId, name) => {
      set((state) => {
        state.error = null
      })
      try {
        const renamed = await invoke('courseGroups:rename', { groupId, name })
        set((state) => {
          const index = state.groups.findIndex((group) => group.id === groupId)
          if (index !== -1) state.groups[index] = renamed
        })
        return renamed
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    deleteGroup: async (groupId) => {
      set((state) => {
        state.error = null
      })
      try {
        await invoke('courseGroups:delete', { groupId })
        set((state) => {
          state.groups = state.groups.filter((group) => group.id !== groupId)
          // 서버와 같은 규칙: 멤버 과목은 그룹만 잃고 그대로 남는다.
          for (const course of state.courses) {
            if (course.groupId === groupId) course.groupId = null
          }
        })
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
      }
    },

    organizeCourse: async (courseId, groupId, beforeCourseId) => {
      set((state) => {
        state.error = null
      })
      try {
        const courses = await invoke('courses:organize', {
          courseId,
          groupId,
          beforeCourseId
        })
        // 정렬과 소속은 서버가 원자적으로 확정한다 — 돌려준 목록으로 교체.
        set((state) => {
          state.courses = courses
        })
      } catch (error) {
        set((state) => {
          state.error = errorMessage(error)
        })
        throw error
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
