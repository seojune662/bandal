import { expect, test } from 'vitest'
import type { RecordingSession } from '../../../src/shared/recording'
import { isRecentMaterial, MATERIAL_NEW_DURATION_MS, materialStatusKey, openMaterialKeys, whiteboardStatusKey } from '../../../src/renderer/src/features/materials/materialStatus'

test('recent status lasts exactly 24 hours and rejects missing/invalid/future timestamps', () => {
  const added = 1_700_000_000_000
  expect(isRecentMaterial(added, added)).toBe(true)
  expect(isRecentMaterial(added, added + MATERIAL_NEW_DURATION_MS - 1)).toBe(true)
  expect(isRecentMaterial(added, added + MATERIAL_NEW_DURATION_MS)).toBe(false)
  expect(isRecentMaterial(undefined, added)).toBe(false)
  expect(isRecentMaterial(NaN, added)).toBe(false)
  expect(isRecentMaterial(added + 1, added)).toBe(false)
})

test('open state matches original material bindings and collapses duplicate tabs', () => {
  const keys = openMaterialKeys([
    { kind: 'note', payload: { courseId: 'original', relPath: 'same.md' } },
    { kind: 'note', payload: { courseId: 'original', relPath: 'same.md' } },
    { kind: 'pdf', payload: { courseId: 'other', relPath: 'same.md' } },
    { kind: 'whiteboard', payload: { courseId: 'original', boardId: 'board' } },
    { kind: 'recording', payload: { courseId: 'original', sessionId: 'audio' } },
    { kind: 'recording', payload: { courseId: 'other', sessionId: 'audio' } }
  ], [{ id: 'audio', courseId: 'original', audioRelPath: 'recordings/lecture.wav' } as RecordingSession])
  expect([...keys].sort()).toEqual([
    materialStatusKey('original', 'same.md'), materialStatusKey('other', 'same.md'),
    whiteboardStatusKey('original', 'board'), materialStatusKey('original', 'recordings/lecture.wav')
  ].sort())
  expect(openMaterialKeys([], []).size).toBe(0)
})
