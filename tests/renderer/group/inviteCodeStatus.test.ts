/**
 * The line under an invite code.
 *
 * It states the two facts a student weighs before pressing 새 코드 만들기, and
 * a new code kills the old one instantly — so getting either fact wrong sends
 * a dead code into a group chat.
 */
import { describe, expect, test } from 'vitest'
import { inviteCodeStatus } from '../../../src/renderer/src/features/group/inviteCodeStatus'
import type { InviteCodeInfo } from '../../../src/shared/types/group'

const NOW = Date.parse('2026-08-21T00:00:00Z')

function info(over: Partial<InviteCodeInfo> = {}): InviteCodeInfo {
  return {
    code: 'K7M2QX',
    groupId: 'g1',
    expiresAt: '2026-08-28T00:00:00Z',
    maxUses: 0,
    useCount: 0,
    ...over
  }
}

describe('inviteCodeStatus', () => {
  test('counts whole days remaining', () => {
    expect(inviteCodeStatus(info(), NOW).line).toContain('7일 뒤 만료')
  })

  test('falls back to hours inside the last day', () => {
    // "0일 뒤 만료" would read as expired when the code still works.
    const status = inviteCodeStatus(
      info({ expiresAt: '2026-08-21T05:00:00Z' }),
      NOW
    )
    expect(status.line).toContain('5시간 뒤 만료')
    expect(status.expired).toBe(false)
  })

  test('a code past its expiry says so', () => {
    const status = inviteCodeStatus(
      info({ expiresAt: '2026-08-20T00:00:00Z' }),
      NOW
    )
    expect(status.expired).toBe(true)
    expect(status.line).toContain('만료됐어요')
  })

  test('reports how many people came in', () => {
    expect(inviteCodeStatus(info({ useCount: 3 }), NOW).line).toContain(
      '3명 참여함'
    )
  })

  test('an unused multi-use code says nobody has joined', () => {
    expect(inviteCodeStatus(info(), NOW).line).toContain('아직 아무도 안 들어왔어요')
  })

  test('an unused single-use code says so instead', () => {
    expect(inviteCodeStatus(info({ maxUses: 1 }), NOW).line).toContain(
      '한 명만 참여할 수 있어요'
    )
  })

  test('a used-up single-use code is spent even before it expires', () => {
    // Otherwise it reads as live and gets pasted into a chat that cannot use it.
    const status = inviteCodeStatus(info({ maxUses: 1, useCount: 1 }), NOW)
    expect(status.spent).toBe(true)
    expect(status.line).toContain('다 썼어요')
    expect(status.expired).toBe(false)
  })

  test('an unlimited code is never spent', () => {
    expect(inviteCodeStatus(info({ maxUses: 0, useCount: 40 }), NOW).spent).toBe(
      false
    )
  })

  test('an unparseable expiry does not print NaN', () => {
    const status = inviteCodeStatus(info({ expiresAt: 'not a date' }), NOW)
    expect(status.line).not.toContain('NaN')
    expect(status.expired).toBe(false)
  })
})
