import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { PersonalBoard } from '../../../src/shared/types/whiteboard'
import { WhiteboardPickerPopover } from '../../../src/renderer/src/features/pdf/popovers'
import { destinationForBoards } from '../../../src/renderer/src/features/pdf/useWhiteboardClipDelivery'

function board(id: string, title: string): PersonalBoard {
  return {
    id,
    courseId: 'course-1',
    title,
    background: 'grid',
    surface: 'dark',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('PDF whiteboard destination', () => {
  const first = board('board-1', '개념 정리')
  const second = board('board-2', '문제 풀이')

  test('creates for zero boards, sends directly for one, and asks for two', () => {
    expect(destinationForBoards([])).toEqual({ kind: 'create' })
    expect(destinationForBoards([first])).toEqual({ kind: 'direct', board: first })
    expect(destinationForBoards([first, second])).toEqual({
      kind: 'choose',
      boards: [first, second]
    })
  })

  test('lists every existing board and a new-whiteboard action', () => {
    const html = renderToStaticMarkup(
      <WhiteboardPickerPopover
        boards={[first, second]}
        position={{ left: 120, top: 80 }}
        onPick={vi.fn()}
        onCreate={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(html).toContain('role="menu"')
    expect(html).toContain('개념 정리')
    expect(html).toContain('문제 풀이')
    expect(html).toContain('새 화이트보드')
    expect(html.match(/role="menuitem"/g)).toHaveLength(3)
  })
})
