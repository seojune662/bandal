import { describe, expect, test } from 'vitest'
import { buildLinkFavoriteInput } from '../../../src/renderer/src/features/courses/linkFavorite'

describe('link favorite input', () => {
  test('normalizes a bare URL into a browser descriptor', () => {
    expect(
      buildLinkFavoriteInput('course-1', ' lms.example.ac.kr/class ', ' LMS ', 'tab-1')
    ).toEqual({
      courseId: 'course-1',
      label: 'LMS',
      descriptor: {
        kind: 'browser',
        payload: {
          tabId: 'tab-1',
          initialUrl: 'https://lms.example.ac.kr/class'
        }
      }
    })
  })

  test('rejects invalid URLs and blank names', () => {
    expect(() =>
      buildLinkFavoriteInput('course-1', '검색어', '검색', 'tab-1')
    ).toThrow('올바른 http(s) 주소')
    expect(() =>
      buildLinkFavoriteInput('course-1', 'https://example.com', ' ', 'tab-1')
    ).toThrow('링크 이름')
  })
})
