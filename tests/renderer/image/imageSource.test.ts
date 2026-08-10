import { describe, expect, test } from 'vitest'
import {
  imageDataUrl,
  imageMimeType
} from '../../../src/renderer/src/features/image/imageSource'

describe('image source', () => {
  test('maps supported extensions to image MIME types', () => {
    expect(imageMimeType('slides/diagram.PNG')).toBe('image/png')
    expect(imageMimeType('photo.jpeg')).toBe('image/jpeg')
    expect(imageMimeType('vector.svg')).toBe('image/svg+xml')
    expect(imageMimeType('without-extension')).toBeNull()
  })

  test('builds a base64 data URL without fetching it', () => {
    expect(
      imageDataUrl('figure.webp', { encoding: 'base64', data: 'YWJj' })
    ).toBe('data:image/webp;base64,YWJj')
  })

  test('rejects text content and unsupported image extensions', () => {
    expect(
      imageDataUrl('figure.png', { encoding: 'utf8', data: 'not binary' })
    ).toBeNull()
    expect(
      imageDataUrl('figure.tiff', { encoding: 'base64', data: 'YWJj' })
    ).toBeNull()
  })
})
