import type { DrawingShape } from '../../../../shared/types/drawing'

export type CanvasShapeInput = Omit<
  DrawingShape,
  'id' | 'createdAt' | 'updatedAt'
>

/** Builds the shape shown immediately while its local IPC write is in flight. */
export function createOptimisticCanvasShape(
  input: CanvasShapeInput,
  id: string,
  timestamp: string
): DrawingShape {
  return {
    id,
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

/** Inserts a new optimistic shape or replaces its server-confirmed version. */
export function putOptimisticCanvasShape(
  shapes: readonly DrawingShape[],
  shape: DrawingShape
): DrawingShape[] {
  const index = shapes.findIndex((entry) => entry.id === shape.id)
  if (index < 0) return [...shapes, shape]
  return shapes.map((entry, entryIndex) =>
    entryIndex === index ? shape : entry
  )
}

/** Applies a text/move/resize edit before the upsert completes. */
export function updateOptimisticCanvasShape(
  shapes: readonly DrawingShape[],
  id: string,
  patch: Partial<Pick<DrawingShape, 'data' | 'style'>>,
  timestamp: string
): DrawingShape[] {
  return shapes.map((shape) =>
    shape.id === id
      ? {
          ...shape,
          data: patch.data ?? shape.data,
          style: patch.style ?? shape.style,
          updatedAt: timestamp
        }
      : shape
  )
}

/** Hides erased shapes immediately while the soft-delete is persisted. */
export function removeOptimisticCanvasShapes(
  shapes: readonly DrawingShape[],
  ids: readonly string[]
): DrawingShape[] {
  const removed = new Set(ids)
  return shapes.filter((shape) => !removed.has(shape.id))
}
