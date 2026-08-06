import { beforeEach, describe, expect, test } from 'vitest'
import type { Drawing } from '../../../src/shared/types/drawing'
import {
  drawingFileKey,
  usePdfToolStore
} from '../../../src/renderer/src/features/pdf/tools/toolStore'

const drawing: Drawing = {
  id: 'drawing-1',
  courseId: 'course-1',
  relPath: 'slides.pdf',
  page: 1,
  kind: 'rect',
  data: { box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
  style: { color: 'blue', width: 0.004, opacity: 1 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('pdf toolStore history', () => {
  beforeEach(() => usePdfToolStore.setState({ histories: {} }))

  test('keeps similarly-delimited course/path pairs in separate histories', () => {
    expect(drawingFileKey('a:b', 'c')).not.toBe(drawingFileKey('a', 'b:c'))
  })

  test('moves inverse operations between per-file undo and redo stacks', () => {
    const key = drawingFileKey(drawing.courseId, drawing.relPath)
    const state = usePdfToolStore.getState()
    state.recordHistory(key, { kind: 'remove', drawings: [drawing] })

    const undo = usePdfToolStore.getState().beginUndo(key)
    expect(undo?.kind).toBe('remove')
    if (undo !== null) {
      usePdfToolStore.getState().finishUndo(key, { kind: 'restore', drawings: undo.drawings })
    }

    const redo = usePdfToolStore.getState().beginRedo(key)
    expect(redo?.kind).toBe('restore')
    expect(usePdfToolStore.getState().histories[key]?.undo).toHaveLength(0)
  })

  test('new edits clear redo only for the edited file', () => {
    const first = drawingFileKey('course-1', 'first.pdf')
    const second = drawingFileKey('course-1', 'second.pdf')
    const state = usePdfToolStore.getState()
    state.recordHistory(first, { kind: 'remove', drawings: [drawing] })
    const action = usePdfToolStore.getState().beginUndo(first)
    if (action !== null) {
      usePdfToolStore.getState().finishUndo(first, { kind: 'restore', drawings: action.drawings })
    }
    state.recordHistory(second, { kind: 'remove', drawings: [drawing] })

    expect(usePdfToolStore.getState().histories[first]?.redo).toHaveLength(1)
    expect(usePdfToolStore.getState().histories[second]?.undo).toHaveLength(1)
  })
})
