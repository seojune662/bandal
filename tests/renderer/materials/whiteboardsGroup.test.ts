import { describe, expect, test } from 'vitest'
import type { PersonalBoard } from '../../../src/shared/types/whiteboard'
import { sortPersonalBoards } from '../../../src/renderer/src/features/materials/WhiteboardsGroup'

function board(
  id: string,
  sortOrder: number,
  createdAt: string
): PersonalBoard {
  return {
    id,
    courseId: 'course-1',
    title: id,
    background: 'grid',
    surface: 'dark',
    sortOrder,
    createdAt,
    updatedAt: createdAt
  }
}

describe('whiteboard materials group', () => {
  test('orders database boards independently of the material file tree', () => {
    const boards = [
      board('later', 2, '2026-08-01T00:00:00.000Z'),
      board('same-order-newer', 1, '2026-08-02T00:00:00.000Z'),
      board('same-order-older', 1, '2026-08-01T00:00:00.000Z')
    ]

    expect(sortPersonalBoards(boards).map((entry) => entry.id)).toEqual([
      'same-order-older',
      'same-order-newer',
      'later'
    ])
    expect(boards.map((entry) => entry.id)).toEqual([
      'later',
      'same-order-newer',
      'same-order-older'
    ])
  })
})
