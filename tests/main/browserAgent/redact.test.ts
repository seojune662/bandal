import { describe, expect, test } from 'vitest'
import {
  redactText,
  redactUrl,
  redactValue
} from '../../../src/main/features/browserAgent/redact'

describe('redactValue', () => {
  test('a password field is never recorded, in any form', () => {
    // Not masked, not length-hinted: absent. A masked password still tells an
    // observer that one was typed here, and how long it was.
    expect(redactValue('hunter2', { fieldType: 'password' })).toBeNull()
    expect(redactValue('', { fieldType: 'password' })).toBeNull()
  })

  test('the saved username is not echoed back either', () => {
    expect(
      redactValue('2021-12345', { knownUsername: '2021-12345' })
    ).toBeNull()
    expect(redactValue(' 2021-12345 ', { knownUsername: '2021-12345' })).toBeNull()
  })

  test('masks long digit runs — 학번, 주민번호, 카드번호', () => {
    expect(redactValue('학번은 2021123456 입니다')).toBe('학번은 ██████ 입니다')
    expect(redactValue('900101-1234567')).toBe('██████')
    expect(redactValue('4111 1111 1111 1111')).toContain('██████')
  })

  test('leaves short numbers alone', () => {
    // A week number or a page number is not an identifier.
    expect(redactValue('3주차')).toBe('3주차')
    expect(redactValue('2026')).toBe('2026')
  })

  test('trims but otherwise preserves ordinary text', () => {
    expect(redactValue('  해시 충돌  ')).toBe('해시 충돌')
  })

  test('an empty value is empty, not null', () => {
    // Distinguishable from "must not be recorded".
    expect(redactValue('   ')).toBe('')
  })

  test('a different username is not suppressed', () => {
    expect(redactValue('someone', { knownUsername: 'other' })).toBe('someone')
  })
})

describe('redactUrl', () => {
  test('drops the query and fragment', () => {
    // Portal URLs routinely carry a session key or a 학번 there.
    expect(
      redactUrl('https://portal.ac.kr/main?ssoToken=abc123&sid=2021123456#tab')
    ).toBe('https://portal.ac.kr/main')
  })

  test('keeps the port, which is part of the identity', () => {
    expect(redactUrl('https://portal.inha.ac.kr:8443/x?y=1')).toBe(
      'https://portal.inha.ac.kr:8443/x'
    )
  })

  test('junk becomes empty rather than leaking through', () => {
    expect(redactUrl('not a url')).toBe('')
  })
})

describe('redactText', () => {
  test('masks identifiers inside a summary line', () => {
    expect(redactText('2021123456 님의 성적')).toBe('██████ 님의 성적')
  })

  test('non-strings do not throw', () => {
    expect(redactText(undefined as unknown as string)).toBe('')
  })
})
