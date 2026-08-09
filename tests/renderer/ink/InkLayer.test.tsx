import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import {
  createTextBoxShape,
  InkLayer
} from '../../../src/renderer/src/features/ink/InkLayer'

const box = { x: 0.2, y: 0.3, width: 0.26, height: 0.08 }
const style = { color: 'ink' as const, width: 0.006, opacity: 1, fontScale: 1 }

function savedShape(overrides: Partial<DrawingShape>): DrawingShape {
  return {
    id: 'shape-1',
    kind: 'ink',
    data: { points: [{ x: 0.4, y: 0.5, p: 0.5 }] },
    style,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function renderLayer(shapes: DrawingShape[]): string {
  return renderToStaticMarkup(
    <InkLayer
      aspect={0.75}
      baseWidthPx={800}
      shapes={shapes}
      tool={{ activeTool: 'select', color: 'ink', width: 0.006, opacity: 1 }}
      onCreate={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      deferTextCreation
      ariaLabel="테스트 캔버스"
    />
  )
}

describe('InkLayer textbox drafts', () => {
  test('does not create a shape when a textbox draft is left empty', () => {
    expect(createTextBoxShape(box, '', style)).toBeNull()
    expect(createTextBoxShape(box, '   \n', style)).toBeNull()
  })

  test('preserves entered text when committing a textbox draft', () => {
    expect(createTextBoxShape(box, '  핵심 개념  ', style)).toEqual({
      kind: 'textbox',
      data: { box, text: '  핵심 개념  ' },
      style
    })
  })

  test('does not mount saved one-point strokes or empty textboxes', () => {
    const html = renderLayer([
      savedShape({}),
      savedShape({ id: 'shape-2', kind: 'textbox', data: { box, text: '' } })
    ])

    expect(html).not.toContain('<path')
    expect(html).not.toContain('<foreignObject')
  })

  test('counter-scales textbox HTML inside the normalized SVG viewBox', () => {
    const html = renderLayer([
      savedShape({ kind: 'textbox', data: { box, text: '핵심 개념' } })
    ])

    expect(html).toContain('transform:scale(')
    expect(html).toContain('font-size:20.8px')
    expect(html).toContain('핵심 개념')
  })
})
