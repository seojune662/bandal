import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import {
  createTextBoxShape,
  InkLayer
} from '../../../src/renderer/src/features/ink/InkLayer'
import { ClipShape } from '../../../src/renderer/src/features/ink/ClipShape'
import {
  resizeHandleBoxes,
  ResizeHandles
} from '../../../src/renderer/src/features/ink/ResizeHandles'

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

describe('InkLayer resize handles', () => {
  const aspect = 2 / 3
  const clipBox = { x: 0.2, y: 0.25, width: 0.4, height: 0.3 }
  const clip = savedShape({
    kind: 'clip',
    data: {
      box: clipBox,
      clip: { relPath: 'lecture.pdf', page: 2, label: 'lecture.pdf · 2쪽' }
    }
  })

  test('renders all four handles only when a clip is selected', () => {
    const renderClip = (selected: boolean): string => renderToStaticMarkup(
      <ClipShape
        shape={clip}
        box={clipBox}
        aspect={aspect}
        baseWidthPx={900}
        selected={selected}
        onBeginManipulation={vi.fn()}
      />
    )

    expect(renderClip(false)).not.toContain('data-resize-handle')
    const selected = renderClip(true)
    for (const handle of ['nw', 'ne', 'sw', 'se']) {
      expect(selected).toContain(`data-resize-handle="${handle}"`)
    }
  })

  test('places square screen-space handles directly over every box corner', () => {
    const surfaceRect = {
      left: 110,
      top: 70,
      width: 900,
      height: 600
    }
    const corners = {
      nw: [clipBox.x, clipBox.y],
      ne: [clipBox.x + clipBox.width, clipBox.y],
      sw: [clipBox.x, clipBox.y + clipBox.height],
      se: [clipBox.x + clipBox.width, clipBox.y + clipBox.height]
    } as const

    for (const handleBox of resizeHandleBoxes(clipBox, aspect)) {
      const element = {
        getBoundingClientRect: () => {
          const left = surfaceRect.left + handleBox.x * surfaceRect.width
          const top = surfaceRect.top + handleBox.y * surfaceRect.height
          const width = handleBox.width * surfaceRect.width
          const height = handleBox.height * surfaceRect.height
          return { left, top, width, height, right: left + width, bottom: top + height }
        }
      } as SVGRectElement
      const screen = element.getBoundingClientRect()
      const [cornerX, cornerY] = corners[handleBox.handle]

      expect(screen.width).toBeCloseTo(screen.height)
      expect(screen.left + screen.width / 2).toBeCloseTo(
        surfaceRect.left + cornerX * surfaceRect.width
      )
      expect(screen.top + screen.height / 2).toBeCloseTo(
        surfaceRect.top + cornerY * surfaceRect.height
      )
    }
  })

  test('uses the shared four-corner renderer for textboxes too', () => {
    const html = renderToStaticMarkup(
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        <ResizeHandles
          box={clipBox}
          aspect={aspect}
          className="ink-layer__textbox-resize"
          onPointerDown={vi.fn()}
        />
      </svg>
    )

    expect(html.match(/ink-layer__textbox-resize/g)).toHaveLength(4)
  })
})
