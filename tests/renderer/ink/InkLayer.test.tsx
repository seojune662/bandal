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
  ImageShape,
  loadDrawingImage
} from '../../../src/renderer/src/features/ink/ImageShape'
import {
  BANDAL_IMAGE_MIME,
  readBandalImageDragData,
  writeBandalImageDragData
} from '../../../src/renderer/src/features/ink/imageTransfer'
import {
  resizeHandleBoxes,
  ResizeHandles
} from '../../../src/renderer/src/features/ink/ResizeHandles'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

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

  test('counter-scales textbox HTML when text creation is not deferred', () => {
    const html = renderToStaticMarkup(
      <InkLayer
        aspect={0.75}
        baseWidthPx={800}
        shapes={[
          savedShape({ kind: 'textbox', data: { box, text: 'PDF 메모' } })
        ]}
        tool={{ activeTool: 'select', color: 'ink', width: 0.006, opacity: 1 }}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        ariaLabel="PDF 주석"
      />
    )

    expect(html).toContain('transform:scale(')
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

describe('InkLayer image shapes', () => {
  const imageBox = { x: 0.12, y: 0.18, width: 0.42, height: 0.28 }
  const image = savedShape({
    kind: 'image',
    data: {
      box: imageBox,
      image: { relPath: 'images/chart.png', label: 'chart.png' }
    }
  })

  test('counter-scales HTML and reuses all four resize handles', () => {
    const html = renderToStaticMarkup(
      <ImageShape
        shape={image}
        box={imageBox}
        aspect={0.75}
        baseWidthPx={800}
        courseId="course-1"
        selected
        onBeginManipulation={vi.fn()}
      />
    )

    expect(html).toContain('ink-layer__image-group')
    expect(html).toContain('transform:scale(0.00125, 0.0016666666666666668)')
    expect(html).toContain('width:336px')
    expect(html).toContain('height:168.00000000000003px')
    for (const handle of ['nw', 'ne', 'sw', 'se']) {
      expect(html).toContain(`data-resize-handle="${handle}"`)
    }
  })

  test('uses a copy-compatible custom drag payload', () => {
    const values = new Map<string, string>()
    const transfer = {
      effectAllowed: 'move',
      setData: (format: string, value: string) => values.set(format, value),
      getData: (format: string) => values.get(format) ?? ''
    }
    const source = { relPath: 'figures/chart.png', label: 'chart.png' }

    writeBandalImageDragData(transfer, source)

    expect(transfer.effectAllowed).toBe('copy')
    expect(values.has(BANDAL_IMAGE_MIME)).toBe(true)
    expect(readBandalImageDragData(transfer)).toEqual(source)
  })

  test('reads one course image once when multiple shapes use it', async () => {
    const invoke = vi.fn(async () => ({ encoding: 'base64', data: 'YWJj' }))
    setIpcAdapter({ invoke, on: vi.fn() } as unknown as IpcAdapter)
    const source = { relPath: 'figures/cache-test.png', label: 'cache-test.png' }
    try {
      const urls = await Promise.all([
        loadDrawingImage('course-cache-test', source),
        loadDrawingImage('course-cache-test', source)
      ])

      expect(urls).toEqual([
        'data:image/png;base64,YWJj',
        'data:image/png;base64,YWJj'
      ])
      expect(invoke).toHaveBeenCalledTimes(1)
    } finally {
      setIpcAdapter(null)
    }
  })

  test('quietly rejects malformed or unavailable drag data', () => {
    expect(readBandalImageDragData({ getData: () => '' })).toBeNull()
    expect(readBandalImageDragData({
      getData: () => JSON.stringify({ relPath: '../escape.png', label: 'escape.png' })
    })).toBeNull()
  })
})
