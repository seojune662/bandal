/**
 * What decides whether the nickname step appears.
 *
 * The signal is subtle and easy to get wrong: a fresh account is NOT missing a
 * profile — the `handle_new_user` trigger already made one, carrying the
 * placeholder handle `user_<8hex>`. Main projects that placeholder to
 * `nickname: null`, and this selector turns null into a gate.
 */

import { describe, expect, test, vi } from 'vitest'

// The store module is imported for its selectors only; the transport must not
// be reached for `window.bandal` in a node environment.
vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {})
}))

import type { AuthState, MyProfile } from '../../../src/shared/types/auth'
import {
  isPlaceholderNickname,
  isValidNickname,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH
} from '../../../src/shared/group/nickname'
import {
  selectCommunityAvailable,
  selectNeedsNickname,
  selectSignedIn
} from '../../../src/renderer/src/stores/authStore'

function profile(nickname: string | null): MyProfile {
  return { id: 'u1', nickname, avatarColor: 'moon', avatarEmoji: '🌙' }
}

function storeState(auth: AuthState): Parameters<typeof selectNeedsNickname>[0] {
  return { auth } as Parameters<typeof selectNeedsNickname>[0]
}

function state(
  phase: AuthState['phase'],
  nickname: string | null
): Parameters<typeof selectNeedsNickname>[0] {
  return storeState({
    phase,
    profile: phase === 'signed-in' ? profile(nickname) : null,
    online: true,
    errorCode: null
  })
}

describe('selectNeedsNickname', () => {
  test('gates a signed-in account whose nickname is still unset', () => {
    expect(selectNeedsNickname(state('signed-in', null))).toBe(true)
  })

  test('does not gate an account that already picked one', () => {
    expect(selectNeedsNickname(state('signed-in', '서준'))).toBe(false)
  })

  test('never gates before sign-in — including mid-OAuth', () => {
    for (const phase of ['unconfigured', 'signed-out', 'signing-in', 'error'] as const) {
      expect(selectNeedsNickname(state(phase, null))).toBe(false)
    }
  })

  test('a signed-in state with no profile row yet still gates', () => {
    // Offline right after sign-in: adoptSession publishes signed-in with a
    // placeholder profile. Gating is the safe side — nothing is lost by asking.
    expect(
      selectNeedsNickname(
        storeState({
          phase: 'signed-in',
          profile: null,
          online: false,
          errorCode: null
        })
      )
    ).toBe(true)
  })
})

describe('the other auth selectors are unaffected', () => {
  test('community availability tracks only "not unconfigured"', () => {
    expect(selectCommunityAvailable(state('unconfigured', null))).toBe(false)
    expect(selectCommunityAvailable(state('signed-out', null))).toBe(true)
    expect(selectCommunityAvailable(state('signing-in', null))).toBe(true)
  })

  test('signed-in is signed-in regardless of the nickname', () => {
    expect(selectSignedIn(state('signed-in', null))).toBe(true)
    expect(selectSignedIn(state('signing-in', null))).toBe(false)
  })
})

describe('isPlaceholderNickname — the trigger handle', () => {
  test('recognizes exactly user_<8 lowercase hex>', () => {
    expect(isPlaceholderNickname('user_3f9a21bc')).toBe(true)
    expect(isPlaceholderNickname('user_00000000')).toBe(true)
  })

  test('does not swallow a nickname a person would actually choose', () => {
    expect(isPlaceholderNickname('user_seojun')).toBe(false)
    expect(isPlaceholderNickname('user_3f9a21b')).toBe(false)
    expect(isPlaceholderNickname('user_3f9a21bcd')).toBe(false)
    expect(isPlaceholderNickname('서준')).toBe(false)
  })
})

describe('isValidNickname — same rule as the DB CHECK', () => {
  test('accepts 한글, 영문, 숫자, 밑줄', () => {
    expect(isValidNickname('서준')).toBe(true)
    expect(isValidNickname('seojun_01')).toBe(true)
    expect(isValidNickname('a'.repeat(NICKNAME_MAX_LENGTH))).toBe(true)
    expect(isValidNickname('가'.repeat(NICKNAME_MIN_LENGTH))).toBe(true)
  })

  test('rejects the lengths the DB would reject', () => {
    expect(isValidNickname('가')).toBe(false)
    expect(isValidNickname('a'.repeat(NICKNAME_MAX_LENGTH + 1))).toBe(false)
    expect(isValidNickname('')).toBe(false)
  })

  test('rejects spaces, emoji and punctuation', () => {
    expect(isValidNickname('서 준')).toBe(false)
    expect(isValidNickname('서준🌙')).toBe(false)
    expect(isValidNickname('seo.jun')).toBe(false)
    expect(isValidNickname('ㅅㅓㅈㅜㄴ')).toBe(false)
  })
})
