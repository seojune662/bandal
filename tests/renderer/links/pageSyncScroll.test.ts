import { describe, expect, test } from 'vitest'
import { PageSyncScroll } from '../../../src/renderer/src/features/links/pageSyncScroll'

describe('linked scroll acknowledgement', () => {
  test('ignores all echoes at the applied position, including a clamped end', () => {
    const guard = new PageSyncScroll()
    const node = { scrollTop: 0 }
    guard.apply(node, () => { node.scrollTop = 400 })
    expect(guard.isEcho(node)).toBe(true)
    expect(guard.isEcho(node)).toBe(true)
    node.scrollTop = 399.8
    expect(guard.isEcho(node)).toBe(true)
  })

  test('does not drop a wheel reversal before the programmatic scroll event', () => {
    const guard = new PageSyncScroll()
    const node = { scrollTop: 0 }
    guard.apply(node, () => { node.scrollTop = 400 })
    node.scrollTop = 360
    expect(guard.isEcho(node)).toBe(false)
    node.scrollTop = 400
    expect(guard.isEcho(node)).toBe(false)
  })

  test('ignores stale anchors after a newer incoming position', () => {
    const guard = new PageSyncScroll()
    expect(guard.accept(3)).toBe(true)
    expect(guard.accept(2)).toBe(false)
    expect(guard.accept(3)).toBe(false)
    expect(guard.accept(4)).toBe(true)
  })
})
