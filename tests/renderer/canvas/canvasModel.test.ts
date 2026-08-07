import { describe, expect, test } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import {
  createOptimisticCanvasShape,
  putOptimisticCanvasShape,
  removeOptimisticCanvasShapes,
  updateOptimisticCanvasShape
} from '../../../src/renderer/src/features/canvas/canvasModel'

const timestamp = '2026-08-07T00:00:00.000Z'

function shape(id: string, color: DrawingShape['style']['color'] = 'ink'): DrawingShape {
  return createOptimisticCanvasShape(
    {
      kind: 'textbox',
      data: {
        box: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
        text: '핵심 개념'
      },
      style: { color, width: 0.004, opacity: 1, fontScale: 1 }
    },
    id,
    timestamp
  )
}

describe('personal canvas optimistic model', () => {
  test('creates a client-id shape and shows it immediately', () => {
    const optimistic = shape('client-shape')
    const result = putOptimisticCanvasShape([], optimistic)

    expect(result).toEqual([optimistic])
    expect(result[0]?.id).toBe('client-shape')
  })

  test('reconciles the server result by id without making a duplicate', () => {
    const optimistic = shape('same-id')
    const saved = {
      ...shape('same-id', 'blue'),
      updatedAt: '2026-08-07T00:00:01.000Z'
    }

    expect(putOptimisticCanvasShape([optimistic], saved)).toEqual([saved])
  })

  test('updates and removes shapes without mutating the previous array', () => {
    const first = shape('first')
    const second = shape('second')
    const original = [first, second]
    const updated = updateOptimisticCanvasShape(
      original,
      first.id,
      { data: { ...first.data, text: '바뀐 개념' } },
      '2026-08-07T00:00:02.000Z'
    )
    const removed = removeOptimisticCanvasShapes(updated, [second.id])

    expect(original).toEqual([first, second])
    expect(updated[0]?.data.text).toBe('바뀐 개념')
    expect(removed.map((entry) => entry.id)).toEqual(['first'])
  })
})
