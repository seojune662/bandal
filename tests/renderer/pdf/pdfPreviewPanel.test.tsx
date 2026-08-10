import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import {
  PDF_THUMBNAIL_RENDER_WIDTH_PX,
  PdfPreviewPanel
} from '../../../src/renderer/src/features/pdf/PdfPreviewPanel'

describe('PDF preview panel', () => {
  test('lists every page and marks the page at the viewport center', () => {
    const html = renderToStaticMarkup(
      <PdfPreviewPanel
        pdf={null}
        numPages={3}
        currentPage={2}
        onJump={vi.fn()}
      />
    )

    expect(html).toContain('aria-label="PDF 미리보기"')
    expect(html.match(/class="pdf-preview__item"/g)).toHaveLength(3)
    expect(html).toContain('aria-label="2쪽으로 이동" aria-current="page"')
  })

  test('uses a deliberately small pdf.js render width', () => {
    expect(PDF_THUMBNAIL_RENDER_WIDTH_PX).toBe(160)
    expect(PDF_THUMBNAIL_RENDER_WIDTH_PX).toBeLessThan(300)
  })
})
