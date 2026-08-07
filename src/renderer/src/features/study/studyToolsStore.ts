import { create } from 'zustand'
import type {
  RunStudyToolInput,
  RunStudyToolResult,
  StudyToolDefinition,
  StudyToolId
} from '../../../../shared/types/study'
import { invoke } from '../../lib/ipc'

type RunningStudyTools = Partial<Record<StudyToolId, number>>

interface StudyToolsState {
  tools: StudyToolDefinition[]
  hasLoaded: boolean
  isLoading: boolean
  error: string | null
  running: RunningStudyTools
  runError: string | null
  loadTools: () => Promise<void>
  run: (input: RunStudyToolInput) => Promise<RunStudyToolResult>
}

let toolsRequest: Promise<void> | null = null

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback
}

export const useStudyToolsStore = create<StudyToolsState>()((set, get) => ({
  tools: [],
  hasLoaded: false,
  isLoading: false,
  error: null,
  running: {},
  runError: null,

  loadTools: () => {
    if (get().hasLoaded) return Promise.resolve()
    if (toolsRequest !== null) return toolsRequest

    set({ isLoading: true, error: null })
    toolsRequest = invoke('study:tools', {})
      .then(({ tools }) => {
        set({ tools, hasLoaded: true, isLoading: false, error: null })
      })
      .catch((error: unknown) => {
        set({
          isLoading: false,
          error: errorMessage(error, 'AI 학습 도구를 불러오지 못했어요.')
        })
      })
      .finally(() => {
        toolsRequest = null
      })

    return toolsRequest
  },

  run: async (input) => {
    set((state) => ({
      running: {
        ...state.running,
        [input.tool]: (state.running[input.tool] ?? 0) + 1
      },
      runError: null
    }))

    try {
      return await invoke('study:run', input)
    } catch (error) {
      set({
        runError: errorMessage(error, 'AI 학습 자료를 만들지 못했어요.')
      })
      throw error
    } finally {
      set((state) => {
        const running = { ...state.running }
        const remaining = (running[input.tool] ?? 1) - 1
        if (remaining === 0) delete running[input.tool]
        else running[input.tool] = remaining
        return { running }
      })
    }
  }
}))
