import { expect, test } from 'vitest'
import { overlapsNativePage } from '../../../src/renderer/src/features/browser/useNativePageOcclusion'
test('a menu obscures only intersecting native panes and ignores a touching edge', () => {
  const left = { x: 0, y: 80, width: 400, height: 600 }
  const right = { x: 400, y: 80, width: 400, height: 600 }
  const menu = [{ x: 410, y: 100, width: 200, height: 300 }]
  expect(overlapsNativePage(left, menu)).toBe(false)
  expect(overlapsNativePage(right, menu)).toBe(true)
  expect(overlapsNativePage(left, [right])).toBe(false)
  expect(overlapsNativePage(null, menu)).toBe(false)
})
