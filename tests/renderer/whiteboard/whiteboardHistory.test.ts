import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import { useInkToolStore } from '../../../src/renderer/src/features/ink'
import { settleWhiteboardUndo } from '../../../src/renderer/src/features/whiteboard/WhiteboardTab'

function drawing(id: string): DrawingShape {
  return {
    id,
    kind: 'rect',
    data: { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
    style: { color: 'blue', width: 0.01, opacity: 1 },
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z'
  }
}

describe('shared whiteboard history safety', () => {
  beforeEach(() => {
    useInkToolStore.setState({ histories: {} })
  })

  test('drops a stale top entry so undo can reach the item below it', () => {
    const surfaceKey = 'whiteboard:board-1'
    const store = useInkToolStore.getState()
    store.recordHistory(surfaceKey, {
      kind: 'update',
      drawings: [drawing('reachable')]
    })
    store.recordHistory(surfaceKey, {
      kind: 'update',
      drawings: [drawing('missing')]
    })
    const execute = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ kind: 'update', drawings: [drawing('reachable')] })

    settleWhiteboardUndo(surfaceKey, execute)
    expect(useInkToolStore.getState().histories[surfaceKey]?.undo).toHaveLength(1)

    settleWhiteboardUndo(surfaceKey, execute)
    expect(execute.mock.calls.map(([action]) => action.drawings[0]?.id)).toEqual([
      'missing',
      'reachable'
    ])
    expect(useInkToolStore.getState().histories[surfaceKey]?.undo).toEqual([])
  })
})
