import { describe, expect, test } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import { mergeWhiteboardShapes } from '../../../src/renderer/src/features/whiteboard/whiteboardModel'

function shape(id: string, updatedAt: string): DrawingShape {
  return {
    id,
    kind: 'ink',
    data: { points: [{ x: 0.2, y: 0.3, p: 0.5 }] },
    style: { color: 'ink', width: 0.004, opacity: 1 },
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt
  }
}

describe('mergeWhiteboardShapes', () => {
  test('unions local and remote shapes by id without duplicates', () => {
    const optimistic = shape('same-id', '2026-08-07T00:00:00.000Z')
    const canonical = shape('same-id', '2026-08-07T00:00:01.000Z')
    const remote = shape('remote-id', '2026-08-07T00:00:02.000Z')

    const once = mergeWhiteboardShapes([optimistic], [canonical, remote])
    const twice = mergeWhiteboardShapes(once, [canonical, remote])

    expect(twice).toHaveLength(2)
    expect(twice.map((entry) => entry.id)).toEqual(['remote-id', 'same-id'])
    expect(twice.find((entry) => entry.id === 'same-id')?.updatedAt).toBe(
      canonical.updatedAt
    )
  })

  test('does not revive a removed shape from a stale remote batch', () => {
    const removed = shape('removed-id', '2026-08-07T00:00:00.000Z')

    expect(mergeWhiteboardShapes([removed], [removed], ['removed-id'])).toEqual([])
  })
})
