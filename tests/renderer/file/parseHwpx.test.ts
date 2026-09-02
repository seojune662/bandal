// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import {
  parseHwpxSections,
  sortSectionPaths
} from '../../../src/renderer/src/features/file/hwpx/parseHwpx'

const HP_NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'

describe('sortSectionPaths', () => {
  test('orders numerically, not lexicographically', () => {
    expect(sortSectionPaths([
      'Contents/section10.xml',
      'Contents/section2.xml',
      'Contents/section0.xml'
    ])).toEqual([
      'Contents/section0.xml',
      'Contents/section2.xml',
      'Contents/section10.xml'
    ])
  })
})

describe('parseHwpxSections', () => {
  test('extracts paragraph text from hp-namespaced sections', () => {
    const xml = `<?xml version="1.0"?>
      <hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ${HP_NS}>
        <hp:p><hp:run><hp:t>첫 문단</hp:t></hp:run></hp:p>
        <hp:p><hp:run><hp:t>둘째 </hp:t></hp:run><hp:run><hp:t>문단</hp:t></hp:run></hp:p>
      </hs:sec>`
    expect(parseHwpxSections([xml])).toEqual(['첫 문단', '둘째 문단'])
  })

  test('skips unparsable xml instead of throwing', () => {
    const good = `<sec ${HP_NS}><hp:p><hp:run><hp:t>ok</hp:t></hp:run></hp:p></sec>`
    expect(parseHwpxSections(['<broken<<', good])).toEqual(['ok'])
  })

  test('multiple sections concatenate in order', () => {
    const section = (text: string): string =>
      `<sec ${HP_NS}><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></sec>`
    expect(parseHwpxSections([section('1장'), section('2장')])).toEqual(['1장', '2장'])
  })
})
