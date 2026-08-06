import { describe, expect, test, vi } from 'vitest'
import {
  BANDAL_TAB_DRAG_MIME,
  writeWorkspaceTabDragData
} from '../../../src/renderer/src/features/workspace/tabDrag'
import { descriptorFor } from '../../../src/renderer/src/features/workspace/tabIdentity'

describe('writeWorkspaceTabDragData', () => {
  test('adds the Bandal payload and useful text fallback without clearing data', () => {
    const values = new Map<string, string>([
      ['application/x-existing-dockview-data', 'keep-me']
    ])
    const setData = vi.fn((type: string, value: string) => values.set(type, value))
    const descriptor = descriptorFor('pdf', {
      courseId: 'course-1',
      relPath: 'week-1/slides.pdf'
    })

    writeWorkspaceTabDragData(
      { setData } as unknown as DataTransfer,
      descriptor,
      'slides.pdf'
    )

    expect(JSON.parse(values.get(BANDAL_TAB_DRAG_MIME) ?? '')).toEqual({
      descriptor,
      label: 'slides.pdf'
    })
    expect(values.get('text/plain')).toBe('slides.pdf')
    expect(values.get('application/x-existing-dockview-data')).toBe('keep-me')
    expect(setData).toHaveBeenCalledTimes(2)
  })
})
