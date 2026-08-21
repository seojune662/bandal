import { describe, expect, test } from 'vitest'
import { isAllowedExternalUrl } from '../../../src/main/windows/externalUrlPolicy'

describe('external window URL policy', () => {
  test.each([
    'https://a',
    'http://a',
    'mailto:x@y'
  ])('allows %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  test.each([
    'smb://x',
    'ms-msdt:/id',
    'vscode://x',
    'javascript:1',
    'file:///etc/passwd'
  ])('rejects %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })
})
