import { describe, expect, test } from 'vitest'
import {
  isViewableFile,
  viewerKindFor
} from '../../../src/renderer/src/features/file/fileFormats'

describe('viewerKindFor (문서 형식 라우팅)', () => {
  test('routes office and korean document formats', () => {
    expect(viewerKindFor('강의/1주차.pptx')).toBe('slides')
    expect(viewerKindFor('과제/보고서.hwp')).toBe('hwp')
    expect(viewerKindFor('과제/보고서.HWPX')).toBe('hwp')
    expect(viewerKindFor('옛자료/구형.ppt')).toBe('preview')
    expect(viewerKindFor('노트/메모.docx')).toBe('docx')
    expect(viewerKindFor('표/성적.xlsx')).toBe('sheet')
  })

  test('all four requested formats are viewable (no Finder fallback)', () => {
    for (const path of ['a.pptx', 'b.hwp', 'c.hwpx', 'd.ppt', 'e.docx']) {
      expect(isViewableFile(path), path).toBe(true)
    }
    expect(viewerKindFor('unknown.zip')).toBeNull()
  })
})
