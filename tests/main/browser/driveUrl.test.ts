import { describe, expect, test } from 'vitest'
import {
  driveConfirmUrl,
  rewriteDriveUrl
} from '../../../src/main/features/browser/driveUrl'

describe('rewriteDriveUrl', () => {
  test.each([
    'https://drive.google.com/file/d/file-123/view?usp=sharing',
    'https://drive.google.com/open?id=file-123',
    'https://drive.google.com/uc?id=file-123&export=view'
  ])('rewrites Drive file links: %s', (url) => {
    expect(rewriteDriveUrl(url)).toBe(
      'https://drive.google.com/uc?export=download&id=file-123'
    )
  })

  test('rewrites Google Docs documents', () => {
    expect(rewriteDriveUrl(
      'https://docs.google.com/document/d/doc-123/edit'
    )).toBe(
      'https://docs.google.com/document/d/doc-123/export?format=docx'
    )
  })

  test('rewrites Google Sheets spreadsheets', () => {
    expect(rewriteDriveUrl(
      'https://docs.google.com/spreadsheets/d/sheet-123/edit'
    )).toBe(
      'https://docs.google.com/spreadsheets/d/sheet-123/export?format=xlsx'
    )
  })

  test('rewrites Google Slides presentations', () => {
    expect(rewriteDriveUrl(
      'https://docs.google.com/presentation/d/slides-123/edit'
    )).toBe(
      'https://docs.google.com/presentation/d/slides-123/export/pptx'
    )
  })

  test('leaves unrelated URLs unchanged', () => {
    const url = 'https://example.com/file/d/file-123/view'
    expect(rewriteDriveUrl(url)).toBe(url)
  })
})

describe('driveConfirmUrl', () => {
  test('collects the approved hidden fields from the virus-scan form', () => {
    const html = `<!doctype html><form method="get"
      action="https://drive.usercontent.google.com/download">
      <input type="hidden" name="id" value="file-123">
      <input value="download" name="export" type="hidden">
      <input type="hidden" name="confirm" value="t">
      <input type="hidden" name="uuid" value="uuid-456">
      <input type="hidden" name="ignored" value="secret">
    </form>`

    expect(driveConfirmUrl(html)).toBe(
      'https://drive.usercontent.google.com/download?id=file-123&export=download&confirm=t&uuid=uuid-456'
    )
  })

  test('rejects forms posting to a different host', () => {
    expect(driveConfirmUrl(
      '<form action="https://evil.example/download"><input type="hidden" name="id" value="x"></form>'
    )).toBeNull()
  })
})
