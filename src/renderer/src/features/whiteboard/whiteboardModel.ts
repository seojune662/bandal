import type { DrawingShape } from '../../../../shared/types/drawing'

/** Applies an edit without changing identity, creation time, or z-order. */
export function updateWhiteboardShape<TShape extends DrawingShape>(
  shapes: readonly TShape[],
  id: string,
  patch: Partial<Pick<DrawingShape, 'data' | 'style'>>,
  updatedAt: string
): TShape[] {
  return shapes.map((shape) => shape.id === id
    ? {
        ...shape,
        data: patch.data ?? shape.data,
        style: patch.style ?? shape.style,
        updatedAt
      }
    : shape)
}

/**
 * Combines the optimistic renderer state with a server catch-up batch.
 * Incoming shapes win for an existing id so server timestamps/author data can
 * replace the optimistic copy without ever rendering the shape twice.
 */
export function mergeWhiteboardShapes<TShape extends DrawingShape>(
  current: readonly TShape[],
  incoming: readonly TShape[],
  removedIds: readonly string[] = []
): TShape[] {
  const removed = new Set(removedIds)
  const byId = new Map<string, TShape>()

  for (const shape of current) {
    if (!removed.has(shape.id)) byId.set(shape.id, shape)
  }
  for (const shape of incoming) {
    if (!removed.has(shape.id)) byId.set(shape.id, shape)
  }

  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  )
}
