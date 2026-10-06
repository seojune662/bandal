import { describe, expect, test } from 'vitest'
import { sheetPreviewBounds } from '../../../src/renderer/src/features/file/lib/sheetPreviewBounds'

describe('spreadsheet preview allocation', () => {
  test('bounds Excel’s full grid to twenty thousand cells', () => {
    const preview = sheetPreviewBounds({ s: { r: 0, c: 0 }, e: { r: 1048575, c: 16383 } })
    expect(preview).toEqual({ range: { s: { r: 0, c: 0 }, e: { r: 199, c: 99 } }, truncated: true })
  })
  test('also bounds wide sheets with only a few populated rows', () => {
    expect(sheetPreviewBounds({ s: { r: 5, c: 3 }, e: { r: 6, c: 16383 } }))
      .toEqual({ range: { s: { r: 5, c: 3 }, e: { r: 6, c: 102 } }, truncated: true })
  })
  test('preserves ordinary sheets, starting offsets and the two thousand row preview', () => {
    const range = { s: { r: 5, c: 3 }, e: { r: 10, c: 8 } }
    expect(sheetPreviewBounds(range)).toEqual({ range, truncated: false })
    expect(sheetPreviewBounds({ s: { r: 5, c: 3 }, e: { r: 5000, c: 3 } }).range.e.r).toBe(2004)
  })
})
