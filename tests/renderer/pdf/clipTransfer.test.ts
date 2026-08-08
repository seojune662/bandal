import { describe, expect, test } from 'vitest'
import type { DrawingClipSource } from '../../../src/shared/types/drawing'
import {
  BANDAL_CLIP_MIME,
  isDrawingClipSource,
  readBandalClipDragData,
  writeBandalClipDragData
} from '../../../src/renderer/src/features/pdf/clipTransfer'

const source: DrawingClipSource = {
  relPath: 'week-03/lecture.pdf',
  page: 4,
  crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.3 },
  label: 'lecture.pdf · 4쪽 선택 영역'
}

describe('Bandal PDF clip transfer', () => {
  test('writes the documented MIME with reference-only JSON', () => {
    const values = new Map<string, string>()
    const transfer = {
      effectAllowed: 'none',
      setData: (format: string, data: string) => values.set(format, data)
    }

    writeBandalClipDragData(transfer, source)

    expect(transfer.effectAllowed).toBe('copy')
    expect(JSON.parse(values.get(BANDAL_CLIP_MIME) ?? '')).toEqual(source)
    expect(values.get(BANDAL_CLIP_MIME)).not.toContain('base64')
  })

  test('reads a valid source and rejects malformed or out-of-page crops', () => {
    expect(readBandalClipDragData({
      getData: () => JSON.stringify(source)
    })).toEqual(source)
    expect(readBandalClipDragData({ getData: () => '{bad json' })).toBeNull()
    expect(isDrawingClipSource({
      ...source,
      crop: { x: 0.8, y: 0.2, width: 0.4, height: 0.3 }
    })).toBe(false)
  })

  test('sanitizes unknown fields so pixel data cannot enter drawing data', () => {
    const result = readBandalClipDragData({
      getData: () => JSON.stringify({ ...source, pixels: 'base64-image-data' })
    })

    expect(result).toEqual(source)
    expect(result).not.toHaveProperty('pixels')
  })
})
