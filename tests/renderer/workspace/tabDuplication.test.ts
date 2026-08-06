import { describe, expect, test } from 'vitest'
import {
  createDuplicatePanelId,
  panelIdMatchesDescriptor
} from '../../../src/renderer/src/features/workspace/tabDuplication'
import {
  descriptorFor,
  tabPanelId
} from '../../../src/renderer/src/features/workspace/tabIdentity'

describe('duplicate tab panel ids', () => {
  const descriptor = descriptorFor('note', {
    courseId: 'course-1',
    relPath: 'notes/week-1.md'
  })

  test('creates a unique id that still belongs to the descriptor', () => {
    const first = createDuplicatePanelId(descriptor)
    const second = createDuplicatePanelId(descriptor)

    expect(first).not.toBe(second)
    expect(first).not.toBe(tabPanelId(descriptor))
    expect(panelIdMatchesDescriptor(first, descriptor)).toBe(true)
    expect(panelIdMatchesDescriptor(second, descriptor)).toBe(true)
  })

  test('does not accept another descriptor or an empty duplicate suffix', () => {
    const other = descriptorFor('note', {
      courseId: 'course-1',
      relPath: 'notes/week-2.md'
    })

    expect(panelIdMatchesDescriptor(tabPanelId(descriptor), descriptor)).toBe(true)
    expect(
      panelIdMatchesDescriptor(`${tabPanelId(descriptor)}::duplicate::`, descriptor)
    ).toBe(false)
    expect(panelIdMatchesDescriptor(createDuplicatePanelId(descriptor), other)).toBe(
      false
    )
  })
})
