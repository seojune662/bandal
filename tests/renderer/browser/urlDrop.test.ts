import { describe, expect, test } from 'vitest'
import { urlFromDataTransfer } from '../../../src/renderer/src/features/browser/urlDrop'

function transfer(values: Record<string, string>): {
  types: string[]
  getData: (type: string) => string
} {
  return {
    types: Object.keys(values),
    getData: (type) => values[type] ?? ''
  }
}

describe('urlFromDataTransfer', () => {
  test('prefers the first web URL in text/uri-list', () => {
    const data = transfer({
      'text/uri-list': '# source\nhttps://drive.google.com/file/d/one',
      DownloadURL: 'application/pdf:ignored.pdf:https://example.com/ignored.pdf'
    })

    expect(urlFromDataTransfer(data.types, data.getData)).toEqual({
      url: 'https://drive.google.com/file/d/one'
    })
  })

  test('parses the Chromium DownloadURL file name and URL', () => {
    const data = transfer({
      DownloadURL:
        'application/pdf:lecture.pdf:https://drive.google.com/uc?export=download&id=42'
    })

    expect(urlFromDataTransfer(data.types, data.getData)).toEqual({
      url: 'https://drive.google.com/uc?export=download&id=42',
      fileName: 'lecture.pdf'
    })
  })

  test('falls back to the first HTTP href in text/html', () => {
    const data = transfer({
      'text/html':
        '<span>Drive</span><a href="https://drive.google.com/open?id=42&amp;usp=drive_fs">자료</a>'
    })

    expect(urlFromDataTransfer(data.types, data.getData)).toEqual({
      url: 'https://drive.google.com/open?id=42&usp=drive_fs'
    })
  })

  test('accepts text/plain only when it is an HTTP URL', () => {
    const valid = transfer({ 'text/plain': ' https://example.com/file.pdf ' })
    const invalid = transfer({ 'text/plain': 'not a URL' })

    expect(urlFromDataTransfer(valid.types, valid.getData)).toEqual({
      url: 'https://example.com/file.pdf'
    })
    expect(urlFromDataTransfer(invalid.types, invalid.getData)).toBeNull()
  })
})
