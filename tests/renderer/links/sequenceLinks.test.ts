import { describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../../src/shared/tabs'
import type { MaterialLinkRecord } from '../../../src/shared/types/link'
import {
  SEQUENCE_LABEL,
  edgeDropPlan,
  pickSequence
} from '../../../src/renderer/src/features/links/sequenceLinks'

const COURSE_ID = 'course-1'

function descriptor(relPath: string): TabDescriptor {
  return { kind: 'note', payload: { courseId: COURSE_ID, relPath } }
}

function record(
  id: string,
  source: string,
  target: string,
  label: string,
  createdAt: string
): MaterialLinkRecord {
  return {
    id,
    courseId: COURSE_ID,
    source: descriptor(source),
    target: descriptor(target),
    label,
    createdAt
  }
}

describe('pickSequence', () => {
  test('returns nulls when no sequence-labeled records exist', () => {
    const plain = record('a', 'x.md', 'y.md', '', '2026-01-01T00:00:00Z')
    expect(pickSequence([plain], [plain])).toEqual({ prev: null, next: null })
  })

  test('picks only sequence-labeled records', () => {
    const next = record('n', 'me.md', 'after.md', SEQUENCE_LABEL, '2026-01-02T00:00:00Z')
    const prev = record('p', 'before.md', 'me.md', SEQUENCE_LABEL, '2026-01-02T00:00:00Z')
    const noise = record('x', 'me.md', 'other.md', '복습', '2026-01-03T00:00:00Z')

    expect(pickSequence([next, noise], [prev, noise])).toEqual({ prev, next })
  })

  test('prefers the latest record when multiple sequence links exist', () => {
    const older = record('o', 'me.md', 'a.md', SEQUENCE_LABEL, '2026-01-01T00:00:00Z')
    const newer = record('n', 'me.md', 'b.md', SEQUENCE_LABEL, '2026-01-05T00:00:00Z')

    expect(pickSequence([older, newer], []).next).toEqual(newer)
    expect(pickSequence([newer, older], []).next).toEqual(newer)
  })
})

describe('edgeDropPlan', () => {
  const tab = descriptor('current.md')
  const material = descriptor('dropped.pdf')

  test('right edge makes the material the tab\'s next', () => {
    expect(edgeDropPlan('next', tab, material)).toEqual({
      source: tab,
      target: material
    })
  })

  test('left edge makes the material the tab\'s prev', () => {
    expect(edgeDropPlan('prev', tab, material)).toEqual({
      source: material,
      target: tab
    })
  })
})
