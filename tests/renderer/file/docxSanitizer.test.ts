import { describe, expect, test } from 'vitest'
import {
  sanitizeDocxAnchor,
  type SanitizedDocxAnchor
} from '../../../src/renderer/src/features/file/viewers/DocxViewer'

function expectDowngraded(anchor: SanitizedDocxAnchor): void {
  expect(anchor).toEqual({ tagName: 'span', text: '링크 텍스트' })
}

describe('DOCX link sanitizer', () => {
  test.each([
    'smb://x',
    'ms-msdt:/id',
    'vscode://x',
    'javascript:1',
    'file:///etc/passwd',
    'data:text/html,hello'
  ])('downgrades unsupported href %s while preserving text', (href) => {
    expectDowngraded(sanitizeDocxAnchor(href, '링크 텍스트'))
  })

  test('keeps an HTTPS link with external-window protections', () => {
    expect(sanitizeDocxAnchor('https://example.com/docs', '문서')).toEqual({
      tagName: 'a',
      href: 'https://example.com/docs',
      target: '_blank',
      rel: 'noopener noreferrer',
      text: '문서'
    })
  })

  test.each(['mailto:x@y', '/relative/path', '../notes', '#section'])(
    'keeps allowed href %s',
    (href) => {
      expect(sanitizeDocxAnchor(href, '링크').tagName).toBe('a')
    }
  )
})
