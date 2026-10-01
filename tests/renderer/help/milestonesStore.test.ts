import { describe, expect, test } from 'vitest'
import {
  deriveMilestones,
  milestoneProgress,
  treeHasFile,
  type MilestoneFacts
} from '../../../src/renderer/src/features/help/milestonesStore'

const COMPLETE: MilestoneFacts = {
  university: true,
  course: true,
  materials: true,
  agent: true,
  tutorial: true,
  favorite: true,
  question: true,
  pip: true
}

describe('milestone derivation', () => {
  test('keeps the personal learning milestones', () => {
    const items = deriveMilestones(COMPLETE)

    expect(items.map((item) => item.id)).not.toContain('group')
    expect(items).toHaveLength(8)
    expect(milestoneProgress(items)).toBe(100)
  })

  test('calculates progress from visible items only', () => {
    const items = deriveMilestones({
      ...COMPLETE,
      university: false,
      agent: false
    })

    expect(items).toHaveLength(8)
    expect(milestoneProgress(items)).toBe(75)
  })

  test('finds files recursively but does not count empty folders', () => {
    expect(
      treeHasFile([
        {
          relPath: 'week-1',
          name: 'week-1',
          kind: 'dir',
          children: []
        }
      ])
    ).toBe(false)
    expect(
      treeHasFile([
        {
          relPath: 'week-1',
          name: 'week-1',
          kind: 'dir',
          children: [
            { relPath: 'week-1/lecture.pdf', name: 'lecture.pdf', kind: 'pdf' }
          ]
        }
      ])
    ).toBe(true)
  })
})
