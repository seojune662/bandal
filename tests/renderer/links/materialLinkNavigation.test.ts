import { describe, expect, test, vi } from 'vitest'
import {
  openMaterialLink,
  type MaterialLinkNavigationDeps
} from '../../../src/renderer/src/features/notes/materialLinkNavigation'

describe('material link kind navigation', () => {
  test('opens a markdown target as a note without PDF jumps', () => {
    const deps: MaterialLinkNavigationDeps = {
      openMaterial: vi.fn(),
      jumpToPage: vi.fn(),
      jumpToAnnotation: vi.fn()
    }

    openMaterialLink(
      'course-1',
      { relPath: '필기/중간고사.md', page: 4, annotationId: 'legacy-page' },
      deps
    )

    expect(deps.openMaterial).toHaveBeenCalledWith(
      'course-1',
      'note',
      '필기/중간고사.md'
    )
    expect(deps.jumpToPage).not.toHaveBeenCalled()
    expect(deps.jumpToAnnotation).not.toHaveBeenCalled()
  })
})
