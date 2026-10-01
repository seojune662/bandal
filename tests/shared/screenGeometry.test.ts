import { expect, test } from 'vitest'
import { cropPixels } from '../../src/shared/screenGeometry'
test.each([1, 1.25, 1.5, 2])('maps display-local coordinates independently of negative monitor origin at scale %s', scale => {
  expect(cropPixels({ x: 80, y: 40, width: 240, height: 160 }, { width: 1280, height: 800 }, { width: 1280 * scale, height: 800 * scale })).toEqual({ x: 80 * scale, y: 40 * scale, width: 240 * scale, height: 160 * scale })
})
test('clips a drag beyond either screen edge without shifting or including excess pixels', () => {
  expect(cropPixels({ x: -20, y: -10, width: 70, height: 60 }, { width: 100, height: 100 }, { width: 200, height: 200 })).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  expect(cropPixels({ x: 90, y: 80, width: 40, height: 50 }, { width: 100, height: 100 }, { width: 200, height: 200 })).toEqual({ x: 180, y: 160, width: 20, height: 40 })
})
