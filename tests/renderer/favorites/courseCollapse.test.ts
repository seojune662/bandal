import { describe, expect, test, vi } from 'vitest'
import {
  COLLAPSED_COURSES_STORAGE_KEY,
  persistCollapsedCourseIds,
  readCollapsedCourseIds,
  selectAndExpandCourse
} from '../../../src/renderer/src/features/courses/courseCollapse'

class MemoryStorage {
  value: string | null = null

  getItem(key: string): string | null {
    return key === COLLAPSED_COURSES_STORAGE_KEY ? this.value : null
  }

  setItem(key: string, value: string): void {
    if (key === COLLAPSED_COURSES_STORAGE_KEY) this.value = value
  }
}

describe('course collapse persistence', () => {
  test('selecting a collapsed course also expands it', () => {
    const selectCourse = vi.fn()
    const setCourseExpanded = vi.fn()

    selectAndExpandCourse('c1', false, selectCourse, setCourseExpanded)

    expect(selectCourse).toHaveBeenCalledWith('c1')
    expect(setCourseExpanded).toHaveBeenCalledWith('c1', true)
  })

  test('selecting an expanded course leaves its expansion state alone', () => {
    const selectCourse = vi.fn()
    const setCourseExpanded = vi.fn()

    selectAndExpandCourse('c1', true, selectCourse, setCourseExpanded)

    expect(selectCourse).toHaveBeenCalledWith('c1')
    expect(setCourseExpanded).not.toHaveBeenCalled()
  })

  test('round-trips a stable per-course id set', () => {
    const storage = new MemoryStorage()

    persistCollapsedCourseIds(new Set(['c2', 'c1']), storage)

    expect(storage.value).toBe('["c1","c2"]')
    expect([...readCollapsedCourseIds(storage)]).toEqual(['c1', 'c2'])
  })

  test('returns an empty set for corrupt or incorrectly shaped data', () => {
    const storage = new MemoryStorage()
    storage.value = '{broken'
    expect(readCollapsedCourseIds(storage)).toEqual(new Set())
    storage.value = JSON.stringify({ c1: true })
    expect(readCollapsedCourseIds(storage)).toEqual(new Set())
  })

  test('ignores non-string and blank entries', () => {
    const storage = new MemoryStorage()
    storage.value = JSON.stringify(['c1', '', 3, null, 'c2'])

    expect(readCollapsedCourseIds(storage)).toEqual(new Set(['c1', 'c2']))
  })
})
