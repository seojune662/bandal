import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  MaterialNode,
  MaterialSearchHit
} from '../../../shared/types/materials'
import { invoke } from '../lib/ipc'

interface MaterialsState {
  activeCourseId: string | null
  tree: MaterialNode[]
  searchResults: MaterialSearchHit[]
  expandedPaths: Record<string, boolean>
  isLoading: boolean
  isSearching: boolean
  error: string | null
  loadTree: (courseId: string) => Promise<void>
  search: (courseId: string, query: string) => Promise<void>
  clearSearch: () => void
  clear: () => void
  toggleFolder: (relPath: string) => void
}

let treeSequence = 0
let searchSequence = 0

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '자료를 불러오지 못했습니다.'
}

export const useMaterialsStore = create<MaterialsState>()(
  immer((set, get) => ({
    activeCourseId: null,
    tree: [],
    searchResults: [],
    expandedPaths: {},
    isLoading: false,
    isSearching: false,
    error: null,

    loadTree: async (courseId) => {
      const sequence = ++treeSequence
      if (get().activeCourseId !== courseId) {
        set((state) => {
          state.activeCourseId = courseId
          state.tree = []
          state.searchResults = []
          state.expandedPaths = {}
        })
      }
      set((state) => {
        state.isLoading = true
        state.error = null
      })

      try {
        const tree = await invoke('materials:tree', { courseId })
        if (sequence !== treeSequence || get().activeCourseId !== courseId) return
        set((state) => {
          state.tree = tree
          state.isLoading = false
        })
      } catch (error) {
        if (sequence !== treeSequence || get().activeCourseId !== courseId) return
        set((state) => {
          state.isLoading = false
          state.error = errorMessage(error)
        })
      }
    },

    search: async (courseId, query) => {
      const normalizedQuery = query.trim()
      if (normalizedQuery.length === 0) {
        get().clearSearch()
        return
      }

      const sequence = ++searchSequence
      set((state) => {
        state.isSearching = true
        state.error = null
      })
      try {
        const results = await invoke('materials:search', {
          courseId,
          query: normalizedQuery
        })
        if (sequence !== searchSequence || get().activeCourseId !== courseId) return
        set((state) => {
          state.searchResults = results
          state.isSearching = false
        })
      } catch (error) {
        if (sequence !== searchSequence || get().activeCourseId !== courseId) return
        set((state) => {
          state.searchResults = []
          state.isSearching = false
          state.error = errorMessage(error)
        })
      }
    },

    clearSearch: () => {
      searchSequence += 1
      set((state) => {
        state.searchResults = []
        state.isSearching = false
      })
    },

    clear: () => {
      treeSequence += 1
      searchSequence += 1
      set((state) => {
        state.activeCourseId = null
        state.tree = []
        state.searchResults = []
        state.expandedPaths = {}
        state.isLoading = false
        state.isSearching = false
        state.error = null
      })
    },

    toggleFolder: (relPath) => {
      set((state) => {
        state.expandedPaths[relPath] = !state.expandedPaths[relPath]
      })
    }
  }))
)
