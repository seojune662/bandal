import { create } from 'zustand'
import type { Drawing, DrawingColor } from '../../../../../shared/types/drawing'

export type PdfDrawingTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'

export type DrawingHistoryAction =
  | { kind: 'remove'; drawings: Drawing[] }
  | { kind: 'restore'; drawings: Drawing[] }
  | { kind: 'update'; drawings: Drawing[] }

interface DrawingHistory {
  undo: DrawingHistoryAction[]
  redo: DrawingHistoryAction[]
}

interface ToolState {
  activeTool: PdfDrawingTool
  color: DrawingColor
  /** Fraction of the PDF page width. */
  width: number
  opacity: number
  histories: Record<string, DrawingHistory>
  setActiveTool: (tool: PdfDrawingTool) => void
  setColor: (color: DrawingColor) => void
  setWidth: (width: number) => void
  setOpacity: (opacity: number) => void
  recordHistory: (fileKey: string, action: DrawingHistoryAction) => void
  beginUndo: (fileKey: string) => DrawingHistoryAction | null
  finishUndo: (fileKey: string, inverse: DrawingHistoryAction) => void
  cancelUndo: (fileKey: string, action: DrawingHistoryAction) => void
  beginRedo: (fileKey: string) => DrawingHistoryAction | null
  finishRedo: (fileKey: string, inverse: DrawingHistoryAction) => void
  cancelRedo: (fileKey: string, action: DrawingHistoryAction) => void
}

const HISTORY_LIMIT = 100
const EMPTY_HISTORY: DrawingHistory = { undo: [], redo: [] }

export function drawingFileKey(courseId: string, relPath: string): string {
  return JSON.stringify([courseId, relPath])
}

function historyFor(
  histories: Record<string, DrawingHistory>,
  fileKey: string
): DrawingHistory {
  return histories[fileKey] ?? EMPTY_HISTORY
}

function capped(actions: DrawingHistoryAction[]): DrawingHistoryAction[] {
  return actions.length > HISTORY_LIMIT ? actions.slice(-HISTORY_LIMIT) : actions
}

export const usePdfToolStore = create<ToolState>()((set, get) => ({
  activeTool: 'select',
  color: 'ink',
  width: 0.004,
  opacity: 0.95,
  histories: {},

  setActiveTool: (activeTool) => set({ activeTool }),
  setColor: (color) => set({ color }),
  setWidth: (width) => set({ width: Math.min(0.04, Math.max(0.001, width)) }),
  setOpacity: (opacity) => set({ opacity: Math.min(1, Math.max(0.05, opacity)) }),

  recordHistory: (fileKey, action) => {
    set((state) => {
      const history = historyFor(state.histories, fileKey)
      return {
        histories: {
          ...state.histories,
          [fileKey]: { undo: capped([...history.undo, action]), redo: [] }
        }
      }
    })
  },

  beginUndo: (fileKey) => {
    const history = historyFor(get().histories, fileKey)
    const action = history.undo[history.undo.length - 1]
    if (action === undefined) return null
    set((state) => ({
      histories: {
        ...state.histories,
        [fileKey]: { ...historyFor(state.histories, fileKey), undo: history.undo.slice(0, -1) }
      }
    }))
    return action
  },

  finishUndo: (fileKey, inverse) => {
    set((state) => {
      const history = historyFor(state.histories, fileKey)
      return {
        histories: {
          ...state.histories,
          [fileKey]: { ...history, redo: capped([...history.redo, inverse]) }
        }
      }
    })
  },

  cancelUndo: (fileKey, action) => {
    set((state) => {
      const history = historyFor(state.histories, fileKey)
      return {
        histories: {
          ...state.histories,
          [fileKey]: { ...history, undo: capped([...history.undo, action]) }
        }
      }
    })
  },

  beginRedo: (fileKey) => {
    const history = historyFor(get().histories, fileKey)
    const action = history.redo[history.redo.length - 1]
    if (action === undefined) return null
    set((state) => ({
      histories: {
        ...state.histories,
        [fileKey]: { ...historyFor(state.histories, fileKey), redo: history.redo.slice(0, -1) }
      }
    }))
    return action
  },

  finishRedo: (fileKey, inverse) => {
    set((state) => {
      const history = historyFor(state.histories, fileKey)
      return {
        histories: {
          ...state.histories,
          [fileKey]: { ...history, undo: capped([...history.undo, inverse]) }
        }
      }
    })
  },

  cancelRedo: (fileKey, action) => {
    set((state) => {
      const history = historyFor(state.histories, fileKey)
      return {
        histories: {
          ...state.histories,
          [fileKey]: { ...history, redo: capped([...history.redo, action]) }
        }
      }
    })
  }
}))
