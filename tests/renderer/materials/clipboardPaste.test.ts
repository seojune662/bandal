import { describe, expect, test } from 'vitest'
import {
  isEditablePasteTarget,
  isShortWebUrl,
  markdownForPastedText,
  pastedImageFileName,
  pastedTextFileName,
  planClipboardPaste,
  shouldHandleMaterialsPaste
} from '../../../src/renderer/src/features/materials/clipboardPaste'

function fakeFile(name: string, type: string): File {
  return { name, type } as File
}

describe('materials clipboard paste', () => {
  test('prioritizes copied Finder paths, then images, then text', () => {
    const copied = fakeFile('lecture.pdf', 'application/pdf')
    expect(
      planClipboardPaste(
        { files: [copied], text: '', types: ['Files'] },
        () => '/Users/student/lecture.pdf'
      )
    ).toEqual({ kind: 'files', paths: ['/Users/student/lecture.pdf'] })

    const image = fakeFile('capture', 'image/png')
    expect(
      planClipboardPaste(
        { files: [image], text: '', types: ['Files'] },
        () => ''
      )
    ).toEqual({ kind: 'images', files: [image] })

    expect(
      planClipboardPaste(
        { files: [], text: '수업 메모', types: ['text/plain'] },
        () => ''
      )
    ).toEqual({ kind: 'text', text: '수업 메모' })
  })

  test('returns explicit reasons for empty and unsupported clipboards', () => {
    expect(
      planClipboardPaste({ files: [], text: '  ', types: [] }, () => '')
    ).toMatchObject({ kind: 'empty', reason: expect.any(String) })
    expect(
      planClipboardPaste(
        { files: [], text: '', types: ['text/html'] },
        () => ''
      )
    ).toMatchObject({ kind: 'unsupported', reason: expect.any(String) })
  })

  test('builds local-time Korean file names and markdown links', () => {
    const date = new Date(2026, 7, 7, 1, 23)
    expect(pastedImageFileName(fakeFile('capture', 'image/png'), date)).toBe(
      '붙여넣은 이미지 2026-08-07 01.23.png'
    )
    expect(pastedTextFileName(date)).toBe(
      '붙여넣은 텍스트 2026-08-07 01.23.md'
    )
    expect(isShortWebUrl('https://bandal.example/lecture')).toBe(true)
    expect(isShortWebUrl('javascript:alert(1)')).toBe(false)
    expect(
      markdownForPastedText('https://bandal.example/lecture', true)
    ).toBe('[링크](https://bandal.example/lecture)\n')
    expect(markdownForPastedText('plain text', false)).toBe('plain text')
  })

  test('does not claim paste events from text-editing descendants', () => {
    const sidebar = { tagName: 'ASIDE', parentElement: null }
    const input = { tagName: 'INPUT', parentElement: sidebar }
    const editor = {
      tagName: 'DIV',
      isContentEditable: true,
      parentElement: sidebar
    }
    expect(isEditablePasteTarget(sidebar as unknown as EventTarget)).toBe(false)
    expect(isEditablePasteTarget(input as unknown as EventTarget)).toBe(true)
    expect(isEditablePasteTarget(editor as unknown as EventTarget)).toBe(true)
    expect(
      shouldHandleMaterialsPaste(false, sidebar as unknown as EventTarget)
    ).toBe(false)
    expect(
      shouldHandleMaterialsPaste(true, sidebar as unknown as EventTarget)
    ).toBe(true)
    expect(shouldHandleMaterialsPaste(true, input as unknown as EventTarget)).toBe(
      false
    )
  })
})
