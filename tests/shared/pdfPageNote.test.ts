import { describe, expect, test } from 'vitest'
import {
  createPdfPageNoteMarkdown,
  hasPdfPageNoteHeader,
  parsePdfPageNote,
  recoverPdfPageNoteAsMarkdown,
  reconcilePdfPageNote,
  serializePdfPageNote,
  sourceRelPath
} from '../../src/shared/pdfPageNote'

const sizes = [
  { width: 612, height: 792 },
  { width: 792, height: 612 }
]

describe('PDF page-note markdown format', () => {
  test('round-trips portable page comments and mixed page sizes', () => {
    const markdown = createPdfPageNoteMarkdown(
      '강의 필기',
      '강의/1부 --> 소개.pdf',
      'fingerprint',
      sizes,
      ['첫 페이지', '## 둘째\n\n- 항목']
    )
    const parsed = parsePdfPageNote(markdown)

    expect(parsed).not.toBeNull()
    expect(parsed?.pages).toEqual(['첫 페이지', '## 둘째\n\n- 항목'])
    expect(parsed?.manifest.pages).toEqual(sizes)
    expect(sourceRelPath(parsed!.manifest)).toBe('강의/1부 --> 소개.pdf')
    expect(serializePdfPageNote(parsed!)).toBe(markdown)
  })

  test('rejects missing, duplicate, and out-of-order page boundaries', () => {
    const valid = createPdfPageNoteMarkdown('필기', 'a.pdf', 'f', sizes)
    expect(parsePdfPageNote(valid.replace('bandal:page 2', 'bandal:page 3'))).toBeNull()
    expect(parsePdfPageNote('# 일반 필기\n')).toBeNull()
  })

  test('recovers damaged page notes as ordinary readable markdown', () => {
    const damaged = [
      '<!-- bandal:pdf-page-note {broken} -->',
      '# 역학 필기',
      '',
      '<!-- bandal:page 1 -->',
      '',
      '- 속도',
      '',
      '<!-- bandal:page 3 -->',
      '',
      '**가속도**'
    ].join('\n')

    expect(hasPdfPageNoteHeader(damaged)).toBe(true)
    expect(recoverPdfPageNoteAsMarkdown(damaged)).toBe(
      '# 역학 필기\n\n## PDF 1쪽 필기\n\n- 속도\n\n## PDF 3쪽 필기\n\n**가속도**\n'
    )
  })

  test('adds pages and archives removed page content without loss', () => {
    const original = parsePdfPageNote(
      createPdfPageNoteMarkdown('필기', 'a.pdf', 'old', sizes, ['첫째', '둘째'])
    )!
    const smaller = reconcilePdfPageNote(
      original,
      'a.pdf',
      'new',
      [{ width: 612, height: 792 }]
    )
    expect(smaller.pages).toEqual(['첫째'])
    expect(smaller.appendix).toContain('기존 PDF 2쪽')
    expect(smaller.appendix).toContain('둘째')

    const larger = reconcilePdfPageNote(smaller, 'a.pdf', 'newer', sizes)
    expect(larger.pages).toEqual(['첫째', ''])
    expect(larger.appendix).toContain('둘째')
  })
})
