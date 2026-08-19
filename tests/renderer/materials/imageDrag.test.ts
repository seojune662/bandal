import { beforeEach, describe, expect, test } from 'vitest'
import type { Course } from '../../../src/shared/types/course'
import { imageSourceFromFileDrop } from '../../../src/renderer/src/features/materials/imageDrag'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'

const course: Course = {
  id: 'course-1',
  name: '자료구조',
  slug: 'course-1',
  color: 'gold',
  folderPath: '/courses/course-1',
  source: 'managed',
  missing: false,
  archived: false,
  groupId: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function droppedFile(name: string): DataTransfer {
  return { files: [{ name } as File] } as unknown as DataTransfer
}

beforeEach(() => {
  useCoursesStore.setState({ courses: [course] })
})

describe('imageSourceFromFileDrop', () => {
  test('returns a source for an image inside the course', () => {
    expect(
      imageSourceFromFileDrop(
        course.id,
        droppedFile('architecture.PNG'),
        () => '/courses/course-1/figures/architecture.PNG'
      )
    ).toEqual({
      relPath: 'figures/architecture.PNG',
      label: 'architecture.PNG'
    })
  })

  test('rejects an image outside the course', () => {
    expect(
      imageSourceFromFileDrop(
        course.id,
        droppedFile('architecture.png'),
        () => '/courses/other/architecture.png'
      )
    ).toBeNull()
  })

  test('rejects a non-image extension', () => {
    expect(
      imageSourceFromFileDrop(
        course.id,
        droppedFile('notes.txt'),
        () => '/courses/course-1/notes.txt'
      )
    ).toBeNull()
  })

  test('rejects files without a backing path', () => {
    expect(
      imageSourceFromFileDrop(course.id, droppedFile('capture.png'), () => '')
    ).toBeNull()
  })
})
