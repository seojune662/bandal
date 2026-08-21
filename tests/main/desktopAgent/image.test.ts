import { describe, expect, it, vi } from 'vitest'
import type { RawCapture } from '../../../src/main/features/desktopAgent/desktopSurface'
import {
  encodeForVision,
  FALLBACK_JPEG_QUALITY,
  fitWithin,
  JPEG_QUALITY,
  MAX_IMAGE_BYTES,
  toScreenPoint
} from '../../../src/main/features/desktopAgent/image'

describe('fitWithin', () => {
  it('fits a landscape image by its long edge', () => {
    expect(fitWithin(1920, 1080, 1568)).toEqual({ width: 1568, height: 882 })
  })

  it('fits a portrait image by its long edge', () => {
    expect(fitWithin(1080, 1920, 1568)).toEqual({ width: 882, height: 1568 })
  })

  it('does not upscale an image that already fits', () => {
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 })
  })
})

describe('encodeForVision', () => {
  it('keeps the q72 encoding when it fits', () => {
    const toJPEG = vi.fn(() => Buffer.alloc(100))
    const result = encodeForVision({ width: 10, height: 10, toJPEG })

    expect(result).toMatchObject({ quality: JPEG_QUALITY, needsSmaller: false })
    expect(toJPEG).toHaveBeenCalledTimes(1)
    expect(toJPEG).toHaveBeenCalledWith(JPEG_QUALITY)
  })

  it('falls back from q72 to q60 before asking for a smaller capture', () => {
    const toJPEG = vi.fn((quality: number) =>
      Buffer.alloc(quality === JPEG_QUALITY ? MAX_IMAGE_BYTES + 1 : 200)
    )
    const result = encodeForVision({ width: 10, height: 10, toJPEG })

    expect(result).toMatchObject({
      quality: FALLBACK_JPEG_QUALITY,
      needsSmaller: false
    })
    expect(toJPEG.mock.calls).toEqual([
      [JPEG_QUALITY],
      [FALLBACK_JPEG_QUALITY]
    ])
  })

  it('asks the caller to recapture when q60 is still oversized', () => {
    const capture: RawCapture = {
      width: 10,
      height: 10,
      toJPEG: vi.fn(() => Buffer.alloc(MAX_IMAGE_BYTES + 1))
    }

    expect(encodeForVision(capture)).toMatchObject({
      quality: FALLBACK_JPEG_QUALITY,
      needsSmaller: true
    })
  })
})

describe('toScreenPoint', () => {
  it('maps a Retina image back into DIP display bounds', () => {
    expect(
      toScreenPoint(784, 507, {
        imageWidth: 1568,
        imageHeight: 1014,
        bounds: { x: 0, y: 0, width: 1728, height: 1117 }
      })
    ).toEqual({ x: 864, y: 558.5 })
  })

  it('includes the offset of a second display', () => {
    expect(
      toScreenPoint(640, 360, {
        imageWidth: 1280,
        imageHeight: 720,
        bounds: { x: 1728, y: -120, width: 1920, height: 1080 }
      })
    ).toEqual({ x: 2688, y: 420 })
  })
})
