import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import {
  layoutTextboxLines,
  usedTextboxFaces
} from '../../src/main/features/textboxPdfLayout'
import type { DrawingStyle } from '../../src/shared/types/drawing'

const style: DrawingStyle = {
  color: 'ink',
  width: 0.002,
  opacity: 1,
  fontSizePt: 14
}

async function fonts() {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  return {
    regular: { metrics: regular, value: 'regular' as const },
    bold: { metrics: bold, value: 'bold' as const }
  }
}

describe('textboxPdfLayout', () => {
  test('applies inline point, color, weight and decoration only to its range', async () => {
    const lines = layoutTextboxLines({
      text: 'plain rich tail',
      textRuns: [{
        from: 6,
        to: 10,
        style: { color: 'red', fontSizePt: 24, bold: true, underline: true }
      }],
      style,
      fonts: await fonts(),
      surfaceWidthPt: 595.28,
      maxWidth: 500
    })

    expect(lines).toHaveLength(1)
    expect(lines[0]?.runs.map((run) => ({
      text: run.text,
      font: run.font,
      color: run.style.color,
      size: run.fontSize,
      underline: run.style.underline === true
    }))).toEqual([
      { text: 'plain ', font: 'regular', color: 'ink', size: 14, underline: false },
      { text: 'rich', font: 'bold', color: 'red', size: 24, underline: true },
      { text: ' tail', font: 'regular', color: 'ink', size: 14, underline: false }
    ])
    expect(lines[0]?.lineHeight).toBe(24 * 1.35)
  })

  test('wraps by measured rich-run width and preserves explicit blank lines', async () => {
    const result = layoutTextboxLines({
      text: 'AAAA\n\nBB',
      style,
      fonts: await fonts(),
      surfaceWidthPt: 595.28,
      maxWidth: 22
    })

    expect(result.map((line) => line.runs.map((run) => run.text).join(''))).toEqual([
      'AA', 'AA', '', 'BB'
    ])
  })

  test('requests both embedded faces when an inline run overrides weight', () => {
    expect([...usedTextboxFaces('normal bold', style, [{
      from: 7,
      to: 11,
      style: { bold: true }
    }])]).toEqual(['regular', 'bold'])
    expect([...usedTextboxFaces('굵게', { ...style, bold: true }, undefined)]).toEqual(['bold'])
    expect([...usedTextboxFaces(' \n', style, [{ from: 0, to: 1, style: { bold: true } }])])
      .toEqual([])
  })
})
