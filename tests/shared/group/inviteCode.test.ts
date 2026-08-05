import { describe, expect, test } from 'vitest'
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  inviteCodeFromClipboard,
  isValidInviteCode,
  normalizeInviteCode,
  toInviteCodeInput
} from '../../../src/shared/group/inviteCode'

describe('alphabet', () => {
  test('is 32 Crockford symbols with the four look-alikes removed', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(32)
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(excluded)
    }
  })

  test('every alphabet symbol passes the check-constraint regex', () => {
    // The SQL check is '^[0-9A-HJ-KM-NP-TV-Z]{6}$'; a symbol we generate but
    // the server rejects would be an unjoinable code.
    for (const symbol of INVITE_CODE_ALPHABET) {
      expect(isValidInviteCode(symbol.repeat(INVITE_CODE_LENGTH))).toBe(true)
    }
  })
})

describe('normalizeInviteCode', () => {
  test('uppercases', () => {
    expect(normalizeInviteCode('k7m2qx')).toBe('K7M2QX')
  })

  test('folds the look-alikes: O→0 and I/L→1', () => {
    expect(normalizeInviteCode('OIL')).toBe('011')
    expect(normalizeInviteCode('oil')).toBe('011')
  })

  test('drops spaces, hyphens and other punctuation', () => {
    expect(normalizeInviteCode('K7M2 - QX')).toBe('K7M2QX')
    expect(normalizeInviteCode('k7m2.qx!')).toBe('K7M2QX')
  })

  test('drops U, which is not in the alphabet at all', () => {
    expect(normalizeInviteCode('KUM2QX')).toBe('KM2QX')
  })

  test('matches the SQL translate(upper(x), \'OIL\', \'011\') behaviour', () => {
    expect(normalizeInviteCode('LOIter')).toBe('101TER')
  })

  test('is idempotent', () => {
    const once = normalizeInviteCode('k7m2-qx')
    expect(normalizeInviteCode(once)).toBe(once)
  })

  test('handles empty input without throwing', () => {
    expect(normalizeInviteCode('')).toBe('')
  })
})

describe('isValidInviteCode', () => {
  test('accepts exactly six alphabet symbols', () => {
    expect(isValidInviteCode('K7M2QX')).toBe(true)
  })

  test('rejects the wrong length', () => {
    expect(isValidInviteCode('K7M2Q')).toBe(false)
    expect(isValidInviteCode('K7M2QX9')).toBe(false)
  })

  test('rejects un-normalized input', () => {
    expect(isValidInviteCode('k7m2qx')).toBe(false)
    expect(isValidInviteCode('K7M2QO')).toBe(false)
  })
})

describe('toInviteCodeInput', () => {
  test('normalizes and truncates to six characters', () => {
    expect(toInviteCodeInput('k7m2-qx99')).toBe('K7M2QX')
  })

  test('lets a partial code through unchanged in length', () => {
    expect(toInviteCodeInput('k7m')).toBe('K7M')
  })
})

describe('inviteCodeFromClipboard', () => {
  test('prefills from a bare code', () => {
    expect(inviteCodeFromClipboard('K7M2QX')).toBe('K7M2QX')
  })

  test('prefills from a lowercase / hyphenated code', () => {
    expect(inviteCodeFromClipboard('  k7m2-qx  ')).toBe('K7M2QX')
  })

  test('refuses prose that merely contains a code', () => {
    // A wrong guess costs a rate-limited attempt, so the bar is strict.
    expect(inviteCodeFromClipboard('코드는 K7M2QX 야')).toBeNull()
  })

  test('refuses empty, too-short and too-long clipboards', () => {
    expect(inviteCodeFromClipboard('')).toBeNull()
    expect(inviteCodeFromClipboard('K7M')).toBeNull()
    expect(inviteCodeFromClipboard('x'.repeat(64))).toBeNull()
  })
})

describe('formatInviteCode', () => {
  test('renders the display form', () => {
    expect(formatInviteCode('k7m2qx')).toBe('K7M2QX')
  })
})
