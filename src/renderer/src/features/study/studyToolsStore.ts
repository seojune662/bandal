import { create } from 'zustand'
import type {
  RunStudyToolInput,
  RunStudyToolResult
} from '../../../../shared/types/study'
import type {
  WorkflowPackFollowUp,
  WorkflowPackOutputs
} from '../../../../shared/types/workflowPack'
import { invoke } from '../../lib/ipc'

/** Renderer bridge for the pack-derived study tool response. */
export interface PackStudyToolDefinition {
  id: string
  label: string
  description: string
  worksOnCourse: boolean
  source?: 'builtin' | 'user'
  enabled?: boolean
  usesWeb?: boolean
  outputs?: WorkflowPackOutputs
  outputDir?: string
  outputsDir?: string
  followUp?: WorkflowPackFollowUp
  followUpLabel?: string
}

export interface RunPackStudyToolInput {
  courseId: string
  tool: string
  relPath: string | null
  selection?: string
  followUpOf?: string
}

type RunningStudyTools = Partial<Record<string, number>>

interface StudyToolsState {
  tools: PackStudyToolDefinition[]
  hasLoaded: boolean
  isLoading: boolean
  error: string | null
  running: RunningStudyTools
  runError: string | null
  loadTools: () => Promise<void>
  run: (input: RunPackStudyToolInput) => Promise<RunStudyToolResult>
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
      const request: RunStudyToolInput = {
        courseId: input.courseId,
        tool: input.tool as RunStudyToolInput['tool'],
        relPath: input.relPath,
        ...(input.selection === undefined ? {} : { selection: input.selection })
      }
      if (input.followUpOf !== undefined) {
        Object.assign(request, { followUpOf: input.followUpOf })
      }
      return await invoke('study:run', request)
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
