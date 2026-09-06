import { describe, expect, test } from 'vitest'
import {
  fittedImageSize,
  validateWhiteboardImageFile,
  WHITEBOARD_IMAGE_MAX_SOURCE_BYTES
} from '../../../src/renderer/src/features/whiteboard/imageImport'

function file(type: string, size: number): File {
  return { type, size } as File
}

describe('whiteboard image import', () => {
  test('keeps a small image at its natural dimensions', () => {
    expect(fittedImageSize(1600, 900)).toEqual({ width: 1600, height: 900 })
  })

  test('downscales long edges without changing the ratio', () => {
    expect(fittedImageSize(8000, 4000)).toEqual({ width: 4096, height: 2048 })
  })

  test('rejects decompression-bomb sized dimensions', () => {
    expect(() => fittedImageSize(8000, 8000)).toThrow('32MP 이하')
  })

  test('accepts browser-decodable photo formats case-insensitively', () => {
    expect(() => validateWhiteboardImageFile(file('IMAGE/PNG', 100))).not.toThrow()
    expect(() => validateWhiteboardImageFile(file('image/avif', 100))).not.toThrow()
  })

  test('rejects unsupported and oversized files before decoding', () => {
    expect(() => validateWhiteboardImageFile(file('image/svg+xml', 100))).toThrow(
      'JPEG, PNG, WebP, GIF, AVIF, BMP'
    )
    expect(() => validateWhiteboardImageFile(
      file('image/png', WHITEBOARD_IMAGE_MAX_SOURCE_BYTES + 1)
    )).toThrow('25MB 이하')
  })
})
