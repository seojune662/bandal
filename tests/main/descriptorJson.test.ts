import { describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../src/shared/tabs'
import {
  parseDescriptor,
  serializeDescriptor
} from '../../src/main/features/favorites/descriptorJson'

const descriptor: TabDescriptor = {
  kind: 'pdf',
  payload: { courseId: 'course-1', relPath: '강의/week-1.pdf' }
}

describe('descriptorJson', () => {
  test('round-trips a valid TabDescriptor', () => {
    const serialized = serializeDescriptor(descriptor)

    expect(serialized.descriptor).toEqual(descriptor)
    expect(parseDescriptor(serialized.json)).toEqual(descriptor)
  })

  test('validates both before and after JSON serialization', () => {
    expect(() =>
      serializeDescriptor({
        kind: 'pdf',
        payload: { relPath: 'missing-course.pdf' }
      })
    ).toThrow(/\[validation\].*TabDescriptor/)

    const changesShapeDuringSerialization = {
      kind: 'board',
      payload: {},
      toJSON: () => ({ kind: 'pdf', payload: {} })
    } as unknown as TabDescriptor
    expect(() => serializeDescriptor(changesShapeDuringSerialization)).toThrow(
      /\[validation\].*remain valid after JSON serialization/
    )
  })

  test('turns cycles and invalid persisted JSON into validation errors', () => {
    const payload: Record<string, unknown> = {}
    payload['self'] = payload

    expect(() =>
      serializeDescriptor({ kind: 'board', payload } as TabDescriptor)
    ).toThrow(/\[validation\].*JSON-serializable/)
    expect(() => parseDescriptor('{broken')).toThrow(
      /\[validation\].*valid JSON/
    )
    expect(() => parseDescriptor('{"kind":"pdf","payload":{}}')).toThrow(
      /\[validation\].*TabDescriptor/
    )
  })
})
