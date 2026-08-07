import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { WhiteboardCanvas } from '../../../src/renderer/src/features/whiteboard/WhiteboardCanvas'

describe('WhiteboardCanvas availability', () => {
  test('keeps the drawing surface enabled when sharing is not provisioned', () => {
    const html = renderToStaticMarkup(
      <WhiteboardCanvas
        availability={{ state: 'not-provisioned' }}
        shapes={[]}
        canUndo={false}
        canRedo={false}
        controlsEnabled={true}
        statusMessage={null}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />
    )

    expect(html).toContain('data-availability="not-provisioned"')
    expect(html).toContain('data-drawing-enabled="true"')
    expect(html).toContain(
      '공유 준비가 아직 안 됐어요. 지금 그리는 건 이 기기에만 저장됩니다'
    )
    expect(html).toContain('aria-label="공유 화이트보드 캔버스"')
    expect(html).toContain('aria-label="펜"')
  })
})
