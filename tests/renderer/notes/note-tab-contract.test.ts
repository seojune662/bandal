import { describe, expect, test } from 'vitest'
import NoteTab, {
  isNoteConflict
} from '../../../src/renderer/src/features/notes/NoteTab'

describe('NoteTab panel contract', () => {
  test('provides a default dockview component export', () => {
    expect(typeof NoteTab).toBe('function')
  })

  test.each([
    Object.assign(new Error('mtime changed'), { name: 'ConflictError' }),
    new Error("Error invoking remote method 'notes:write': [conflict] mtime changed"),
    { message: '[conflict] mtime changed' }
  ])('recognizes a wrapped notes conflict', (error) => {
    expect(isNoteConflict(error)).toBe(true)
  })

  test('does not classify an unrelated write failure as a conflict', () => {
    expect(isNoteConflict(new Error('disk full'))).toBe(false)
  })
})
