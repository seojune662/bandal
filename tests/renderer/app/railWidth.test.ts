import { describe, expect, test } from 'vitest'
import {
  RAIL_WIDTH_LIMITS,
  clampRailWidth,
  persistRailWidth,
  readRailWidths
} from '../../../src/renderer/src/app/railWidth'

function memoryStorage(initial: Record<string, string> = {}): {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
} {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value)
  }
}

describe('clampRailWidth', () => {
  test('clamps into per-side limits and rounds', () => {
    expect(clampRailWidth('left', 100)).toBe(RAIL_WIDTH_LIMITS.left.min)
    expect(clampRailWidth('left', 9999)).toBe(RAIL_WIDTH_LIMITS.left.max)
    expect(clampRailWidth('right', 300.6)).toBe(301)
  })

  test('falls back to the default for non-finite input', () => {
    expect(clampRailWidth('right', Number.NaN)).toBe(RAIL_WIDTH_LIMITS.right.default)
  })
})

describe('rail width persistence', () => {
  test('round-trips both sides', () => {
    const storage = memoryStorage()
    persistRailWidth('left', 300, storage)
    persistRailWidth('right', 460, storage)
    expect(readRailWidths(storage)).toEqual({ left: 300, right: 460 })
  })

  test('clamps out-of-range stored values on read', () => {
    const storage = memoryStorage({
      'bandal:rail-widths:v1': JSON.stringify({ left: 20, right: 9000 })
    })
    expect(readRailWidths(storage)).toEqual({
      left: RAIL_WIDTH_LIMITS.left.min,
      right: RAIL_WIDTH_LIMITS.right.max
    })
  })

  test('ignores broken JSON and junk shapes', () => {
    expect(
      readRailWidths(memoryStorage({ 'bandal:rail-widths:v1': '{oops' }))
    ).toEqual({})
    expect(
      readRailWidths(memoryStorage({
        'bandal:rail-widths:v1': JSON.stringify({ left: 'wide' })
      }))
    ).toEqual({})
  })
})
