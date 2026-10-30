import { expect, test } from 'vitest'
import { ValidationError } from '../../../src/main/db/errors'
import { assetExt, courseFields, docLocation, importInkObject, roundAway, toInkObject, type DrawingRow } from '../../../src/main/features/sync/adapter'
import type { InkObject } from '../../../src/main/features/sync/format'

const row = (overrides: Partial<DrawingRow> = {}): DrawingRow => ({
  id: 'e0000000-0000-4000-8000-000000000001', page: 2, kind: 'ink',
  data_json: JSON.stringify({ inkVersion: 5, points: [{ x: 0.1234567, y: -0.0000049, p: 0.12345, t: 7, tiltX: 12.345678 }] }),
  style_json: JSON.stringify({ color: 'blue', width: 0.0031234567, opacity: 1 }),
  created_at: '2026-10-30T00:00:01.000Z', updated_at: '2026-10-30T00:00:02.000Z', deleted_at: null, ...overrides
})
const rect: InkObject = {
  id: 'e0000000-0000-4000-8000-000000000002', kind: 'rect', page: 1, t: 1793318402000, created: 1793318401000,
  data: { box: { x: -0.01, y: 0.9, width: 0.5, height: 0.2 }, futureKey: true }, style: { color: 'red', width: 0.002, opacity: 1, glow: 3 }
}
const imageRow = row({ kind: 'image', data_json: JSON.stringify({ box: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }, image: { relPath: 'images/a.png', label: 'a.png' } }) })

test('rounding is nearest with ties away from zero, and never writes -0', () => {
  expect([roundAway(2.5, 0), roundAway(-2.5, 0), roundAway(0.125, 2), roundAway(-0.125, 2), roundAway(0.1234567, 5)])
    .toEqual([3, -3, 0.13, -0.13, 0.12346])
  expect(Object.is(roundAway(-0.0000049, 5), 0)).toBe(true)
  expect(Object.is(roundAway(-0, 3), 0)).toBe(true)
})

test('asset extensions are lower case, and bin when missing or not allowed', () => {
  expect(['칠판.PNG', 'images/scan.JPEG', '첨부-1f2e', '.png', 'a.', 'a.tar.gz', 'x.ＰＮＧ', 'a.verylongextension1'].map(assetExt))
    .toEqual(['png', 'jpeg', 'bin', 'bin', 'bin', 'gz', 'bin', 'bin'])
})

test('export rounds coordinates to 5 digits and pressure to 3, and leaves other numbers alone', () => {
  const stored = row()
  expect(toInkObject(stored, 1793318402000)).toEqual({
    id: stored.id, kind: 'ink', page: 2, t: 1793318402000, created: Date.parse(stored.created_at),
    data: { inkVersion: 5, points: [{ x: 0.12346, y: 0, p: 0.123, t: 7, tiltX: 12.345678 }] },
    style: { color: 'blue', width: 0.0031234567, opacity: 1 }
  })
  expect(stored).toEqual(row())
})

test('a deleted row exports as a minimal tombstone, even an image with no asset', () => {
  const deleted_at = '2026-10-30T00:00:03.000Z'
  expect(toInkObject(row({ deleted_at }), 5)).toEqual({ id: row().id, page: 2, t: 5, del: true })
  expect(toInkObject({ ...imageRow, deleted_at }, 5)).toEqual({ id: row().id, page: 2, t: 5, del: true })
})

test('board clips stay local and a live image needs its asset hash', () => {
  expect(toInkObject(row({ kind: 'clip' }), 5)).toBeNull()
  expect(toInkObject(imageRow, 5)).toBeNull()
  expect(toInkObject(imageRow, 5, { sha256: 'f'.repeat(64), ext: 'png' })!.data).toEqual({
    box: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }, image: { sha256: 'f'.repeat(64), ext: 'png', label: 'a.png' }
  })
})

test('import clamps into the page and validates like a local save', () => {
  expect(importInkObject(rect)).toEqual({
    action: 'upsert',
    fields: {
      kind: 'rect', page: 1, data: { box: { x: 0, y: 0.9, width: 0.5, height: 1 - 0.9 } }, style: { color: 'red', width: 0.002, opacity: 1 },
      created_at: '2026-10-30T00:00:01.000Z', updated_at: '2026-10-30T00:00:02.000Z'
    }
  })
  expect(() => importInkObject({ ...rect, style: { color: '#ff0000', width: 0.002, opacity: 1 } })).toThrow(ValidationError)
})

test('import says what to do with tombstones, unknown kinds and images whose file is missing', () => {
  expect(importInkObject({ id: rect.id, page: 1, t: Date.UTC(2026, 9, 30), del: true })).toEqual({ action: 'delete', deleted_at: '2026-10-30T00:00:00.000Z' })
  expect(importInkObject({ ...rect, del: true, data: { nonsense: 1 } }).action).toBe('delete')
  expect(importInkObject({ ...rect, kind: 'lasso' })).toEqual({ action: 'hold', reason: 'unknown-kind' })
  const image: InkObject = { ...rect, kind: 'image', data: { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, image: { sha256: 'f'.repeat(64), ext: 'png' } } }
  expect(importInkObject(image)).toEqual({ action: 'hold', reason: 'needs-asset' })
  expect(importInkObject(image, () => 'images/칠판.png')).toMatchObject({ action: 'upsert', fields: { data: { image: { relPath: 'images/칠판.png', label: 'ffffffff.png' } } } })
})

test('import never reads a non-number as a coordinate and fails with ValidationError, not TypeError', () => {
  const ink: InkObject = { ...rect, kind: 'ink', data: { inkVersion: 5, points: [{ x: 0.5, y: 0.5, p: 0.5 }] } }
  for (const data of [{ inkVersion: 5, points: [{ x: null, y: null, p: null }] }, { inkVersion: 5, points: [{ x: '0.5', y: 0.5, p: 0.5 }] }, { inkVersion: 5, points: [null] }]) {
    expect(() => importInkObject({ ...ink, data })).toThrow(ValidationError)
  }
  expect(() => importInkObject({ ...rect, kind: 'image', data: { box: { x: 0, y: 0, width: 0.5, height: 0.5 } } })).toThrow(ValidationError)
  expect(() => importInkObject({ ...rect, kind: 'image', data: { box: { x: 0, y: 0, width: 0.5, height: 0.5 }, image: { sha256: '../x', ext: 'png' } } }, () => 'x')).toThrow(ValidationError)
})

test('import drops optional pen samples it cannot store instead of losing the stroke', () => {
  const ink: InkObject = { ...rect, kind: 'ink', data: { inkVersion: 5, points: [{ x: 0.5, y: 0.5, p: 0.5, t: 90_000_000, tiltX: 120, tiltY: -30 }] } }
  expect(importInkObject(ink)).toMatchObject({ action: 'upsert', fields: { data: { inkVersion: 5, points: [{ x: 0.5, y: 0.5, p: 0.5, tiltY: -30 }] } } })
  expect(importInkObject({ ...rect, data: { ...rect.data, inkVersion: 5 } })).toMatchObject({ action: 'upsert', fields: { data: { box: { x: 0 } } } })
})

test('course and document fields map to the spec', () => {
  expect(courseFields({ name: '물리', sort_order: 3, color: 'violet', archived: 1 })).toEqual({ name: '물리', sort: 3, color: 'violet', archived: true })
  expect(docLocation('1주차/실습/과제.pdf'.normalize('NFD'))).toEqual({ rel_path: '1주차/실습', name: '과제.pdf' })
  expect(docLocation('요약.md')).toEqual({ rel_path: '', name: '요약.md' })
})
