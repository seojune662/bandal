import { describe, expect, test } from 'vitest'
import { materialKindForPath } from '../../src/shared/materialKind'

describe('materialKindForPath', () => {
  test.each([
    ['강의/SLIDES.PDF', 'pdf'],
    ['필기/week-1.md', 'note'],
    ['필기/week-1.MARKDOWN', 'note'],
    ['그림/scan.png', 'image'],
    ['그림/photo.JPEG', 'image'],
    ['그림/raw.heic', 'image'],
    ['영상/lecture.mp4', 'video'],
    ['영상/lecture.M4V', 'video'],
    ['영상/lecture.webm', 'video'],
    ['문서/slides.pptx', 'other'],
    ['영상/lecture.mov', 'other'],
    ['.gitignore', 'other']
  ] as const)('classifies %s as %s', (relPath, expected) => {
    expect(materialKindForPath(relPath)).toBe(expected)
  })
})
