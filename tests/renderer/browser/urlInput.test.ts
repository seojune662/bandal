import { describe, expect, test } from 'vitest'
import {
  addressDisplayParts,
  resolveAddressInput
} from '../../../src/renderer/src/features/browser/urlInput'

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

describe('addressDisplayParts', () => {
  test('decodes percent-encoded Korean paths for display', () => {
    const parts = addressDisplayParts(
      'https://ist.snu.ac.kr/%EA%B3%B5%EA%B0%84%EC%98%88%EC%95%BD'
    )
    expect(parts.domain).toBe('ist.snu.ac.kr')
    expect(parts.suffix).toBe('/공간예약')
    expect(parts.secure).toBe(true)
  })

  test('hides https scheme and www prefix, keeps http visible', () => {
    expect(addressDisplayParts('https://www.google.com/')).toEqual({
      prefix: '',
      domain: 'google.com',
      suffix: '',
      secure: true
    })
    expect(addressDisplayParts('http://example.com/a').prefix).toBe('http://')
  })

  test('keeps malformed percent sequences as-is', () => {
    const parts = addressDisplayParts('https://a.b/%E0%A4%A')
    expect(parts.suffix).toBe('/%E0%A4%A')
  })
})
