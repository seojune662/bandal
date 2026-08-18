/**
 * [R3] extractMaterialText 단위 테스트.
 *
 * - xlsx: 설치된 `xlsx` 라이브러리로 실제 통합문서를 만들어 검증한다.
 * - docx: mammoth 는 docx 를 쓸 수 없고 zip 픽스처를 손으로 만드는 건
 *   깨지기 쉬워서, vi.mock 으로 모듈 경계에서 대체한다 (동적 import 도
 *   vitest 목이 가로챈다).
 * - 텍스트/미지원/잘림 경로는 실제 파일로 검증한다.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { extractMaterialText } from '../../../src/main/features/materials/textExtract'

vi.mock('mammoth', () => ({
  default: {
    extractRawText: async ({ buffer }: { buffer: Buffer }) => ({
      value: `MOCK-DOCX:${buffer.length}bytes`
    })
  }
}))

const dir = mkdtempSync(join(tmpdir(), 'bandal-textextract-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('extractMaterialText', () => {
  test('reads plain text files as UTF-8', async () => {
    const file = join(dir, 'notes.md')
    writeFileSync(file, '# 제목\n본문입니다.', 'utf8')

    const text = await extractMaterialText(file, '.md', 1000)

    expect(text).toBe('# 제목\n본문입니다.')
  })

  test('extension matching is case-insensitive', async () => {
    const file = join(dir, 'UPPER.TXT')
    writeFileSync(file, 'upper', 'utf8')

    expect(await extractMaterialText(file, '.TXT', 100)).toBe('upper')
  })

  test('extracts every sheet of an xlsx as labeled CSV', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['주차', '주제'],
        [1, '오리엔테이션'],
        [2, '자료구조']
      ]),
      '강의계획'
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['성적', 100]]),
      '성적'
    )
    const file = join(dir, 'syllabus.xlsx')
    XLSX.writeFile(workbook, file)

    const text = await extractMaterialText(file, '.xlsx', 20_000)

    expect(text).not.toBeNull()
    expect(text).toContain('## 시트: 강의계획')
    expect(text).toContain('주차,주제')
    expect(text).toContain('2,자료구조')
    expect(text).toContain('## 시트: 성적')
    expect(text).toContain('성적,100')
  })

  test('extracts docx through mammoth (mocked at the module seam)', async () => {
    const file = join(dir, 'report.docx')
    writeFileSync(file, Buffer.from('not-a-real-docx'))

    const text = await extractMaterialText(file, '.docx', 20_000)

    expect(text).toBe('MOCK-DOCX:15bytes')
  })

  test('returns null for pdf (the CLI reads PDFs natively)', async () => {
    const file = join(dir, 'slides.pdf')
    writeFileSync(file, '%PDF-1.4')

    expect(await extractMaterialText(file, '.pdf', 1000)).toBeNull()
  })

  test('returns null for unsupported binary formats', async () => {
    const file = join(dir, 'clip.mp4')
    writeFileSync(file, Buffer.from([0, 1, 2]))

    expect(await extractMaterialText(file, '.mp4', 1000)).toBeNull()
  })

  test('truncates to maxChars with a marker', async () => {
    const file = join(dir, 'long.txt')
    writeFileSync(file, 'a'.repeat(50), 'utf8')

    const text = await extractMaterialText(file, '.txt', 10)

    expect(text).not.toBeNull()
    expect(text).toContain('a'.repeat(10))
    expect(text).not.toContain('a'.repeat(11))
    expect(text).toContain('잘림')
  })

  test('rejects a non-positive maxChars', async () => {
    const file = join(dir, 'whatever.txt')
    writeFileSync(file, 'x', 'utf8')

    await expect(extractMaterialText(file, '.txt', 0)).rejects.toThrow()
  })
})
