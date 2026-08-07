import type { StoreApi, UseBoundStore } from 'zustand'
import type { Drawing } from '../../../../../shared/types/drawing'
import {
  drawingFileKey,
  useInkToolStore,
  type InkHistoryAction,
  type InkTool,
  type InkToolStore
} from '../../ink/inkToolStore'

export type PdfDrawingTool = InkTool
export type DrawingHistoryAction = InkHistoryAction<Drawing>

type PdfToolStore = InkToolStore<Drawing>

export { drawingFileKey }

/** PDF compatibility name backed by the surface-independent ink store. */
export const usePdfToolStore = useInkToolStore as unknown as UseBoundStore<StoreApi<PdfToolStore>>
