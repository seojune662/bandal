import { describe, expect, test } from 'vitest'
import { resolveAddressInput } from '../../../src/renderer/src/features/browser/urlInput'

describe('resolveAddressInput', () => {
  test('passes full URLs through unchanged', () => {
    expect(resolveAddressInput('https://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1'
    )
    expect(resolveAddressInput('http://localhost:5173')).toBe(
      'http://localhost:5173'
    )
  })

  test('defaults bare domains to https', () => {
    expect(resolveAddressInput('example.com')).toBe('https://example.com')
    expect(resolveAddressInput('  docs.example.co.kr/path  ')).toBe(
      'https://docs.example.co.kr/path'
    )
  })

  test('turns non-URL input into a search query', () => {
    expect(resolveAddressInput('푸리에 변환')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('푸리에 변환')}`
    )
    expect(resolveAddressInput('two words')).toBe(
      'https://www.google.com/search?q=two%20words'
    )
  })

  test('returns null for empty input', () => {
    expect(resolveAddressInput('')).toBeNull()
    expect(resolveAddressInput('   ')).toBeNull()
  })
})
