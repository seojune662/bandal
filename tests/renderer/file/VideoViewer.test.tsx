import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { VideoHandoffOverlay } from '../../../src/renderer/src/features/file/viewers/VideoViewer'

describe('VideoViewer handoff', () => {
  test('renders only a neutral PiP status while handed off', () => {
    const html = renderToStaticMarkup(<VideoHandoffOverlay visible />)

    expect(html).toContain('data-handed-off="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('작은 창에서 재생 중')
    expect(html).not.toContain('돌아가기')
  })

  test('renders no handoff surface in the original tab state', () => {
    expect(
      renderToStaticMarkup(<VideoHandoffOverlay visible={false} />)
    ).toBe('')
  })
})
