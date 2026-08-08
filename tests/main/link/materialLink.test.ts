import { describe, expect, test } from 'vitest'
import {
  createMaterialLink,
  parseMaterialLink
} from '../../../src/main/features/link'

describe('material links', () => {
  test('round-trips Korean and URL-significant path characters', () => {
    const link = {
      relPath: '1주차/자료 구조 (#1) & 보충.pdf',
      page: 3,
      annotationId: '강조 (#1) & 다시보기'
    }

    const href = createMaterialLink(link)

    expect(href).toContain('%20')
    expect(href).toContain('%23')
    expect(href).toContain('%26')
    expect(href).toContain('%28')
    expect(href).toContain('%29')
    expect(href).not.toContain('자료 구조')
    expect(parseMaterialLink(href)).toEqual(link)
  })

  test('round-trips a whole-file link without optional fields', () => {
    const link = { relPath: '읽기 자료.pdf', page: null }
    expect(parseMaterialLink(createMaterialLink(link))).toEqual(link)
  })

  test.each([
    'https://example.com/?path=Chap1.pdf&page=3',
    'bandal://auth/callback?path=Chap1.pdf&page=3',
    'bandal://material?page=3',
    'bandal://material?path=Chap1.pdf&page=0',
    'bandal://material?path=Chap1.pdf&page=3.5',
    'not a url'
  ])('rejects a foreign or malformed href: %s', (href) => {
    expect(parseMaterialLink(href)).toBeNull()
  })
})
