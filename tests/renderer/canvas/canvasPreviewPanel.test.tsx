import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { PersonalBoardShape } from '../../../src/shared/types/whiteboard'
import {
  CANVAS_PREVIEW_SHAPE_LIMIT,
  CanvasPreviewPanel
} from '../../../src/renderer/src/features/canvas/CanvasPreviewPanel'

function textbox(id: string, page: number, text: string): PersonalBoardShape {
  return {
    id,
    page,
    kind: 'textbox',
    data: {
      box: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 },
      text
    },
    style: { color: 'ink', width: 0.004, opacity: 1, fontScale: 1 },
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z'
  }
}

describe('whiteboard preview panel', () => {
  test('renders one thumbnail per page and highlights the visible page', () => {
    const html = renderToStaticMarkup(
      <CanvasPreviewPanel
        pageCount={3}
        currentPage={3}
        background="grid"
        shapes={[textbox('shape-1', 1, '첫 쪽')]}
        onJump={vi.fn()}
      />
    )

    expect(html).toContain('aria-label="화이트보드 미리보기"')
    expect(html.match(/class="canvas-preview__item"/g)).toHaveLength(3)
    expect(html).toContain('aria-label="3페이지로 이동" aria-current="page"')
    expect(html).toContain('첫 쪽')
  })

  test('caps miniature SVG shapes per page to keep previews light', () => {
    const shapes = Array.from(
      { length: CANVAS_PREVIEW_SHAPE_LIMIT + 1 },
      (_, index) => textbox(`shape-${index}`, 1, `도형 ${index}`)
    )
    const html = renderToStaticMarkup(
      <CanvasPreviewPanel
        pageCount={1}
        currentPage={1}
        background="blank"
        shapes={shapes}
        onJump={vi.fn()}
      />
    )

    expect(html).not.toContain('도형 0')
    expect(html).toContain(`도형 ${CANVAS_PREVIEW_SHAPE_LIMIT}`)
  })
})
