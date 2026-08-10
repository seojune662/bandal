import { describe, expect, test } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import type { PersonalBoardShape } from '../../../src/shared/types/whiteboard'
import {
  clipBoxAtDrop,
  createOptimisticCanvasShape,
  putOptimisticCanvasShape,
  removeOptimisticCanvasShapes,
  updateOptimisticCanvasShape
} from '../../../src/renderer/src/features/canvas/canvasModel'

const timestamp = '2026-08-07T00:00:00.000Z'

function shape(
  id: string,
  color: DrawingShape['style']['color'] = 'ink',
  page = 1
): PersonalBoardShape {
  return createOptimisticCanvasShape(
    {
      page,
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
    const optimistic = shape('same-id', 'ink', 2)
    const saved = {
      ...shape('same-id', 'blue', 2),
      updatedAt: '2026-08-07T00:00:01.000Z'
    }

    expect(putOptimisticCanvasShape([optimistic], saved)).toEqual([saved])
    expect(saved.page).toBe(2)
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

  test('places clips at one-third width and preserves their pixel aspect', () => {
    const surfaceAspect = 0.75
    const clipAspect = 1.5
    const box = clipBoxAtDrop({ x: 0.5, y: 0.5 }, surfaceAspect, clipAspect)

    expect(box.width).toBeCloseTo(1 / 3)
    expect(box.x + box.width / 2).toBeCloseTo(0.5)
    expect(box.y + box.height / 2).toBeCloseTo(0.5)
    expect(box.height * surfaceAspect / box.width).toBeCloseTo(clipAspect)
  })

  test('keeps a dropped clip inside the finite board', () => {
    const box = clipBoxAtDrop({ x: 1, y: 1 }, 1, 4)

    expect(box.x + box.width).toBeLessThanOrEqual(1)
    expect(box.y + box.height).toBeLessThanOrEqual(1)
    expect(box.height).toBeLessThanOrEqual(0.9)
  })
})
