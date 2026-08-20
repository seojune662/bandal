/**
 * The line under an invite code.
 *
 * Pure, because the two facts it states — how long the code lasts and how many
 * people it has let in — are exactly the two the student weighs before
 * pressing 새 코드 만들기, and getting either wrong sends a dead code to a
 * group chat.
 */

import type { InviteCodeInfo } from '../../../../shared/types/group'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface InviteCodeStatus {
  /** "7일 뒤 만료 · 3명 참여함" */
  line: string
  expired: boolean
  /** A used-up single-use code is spent even before it expires. */
  spent: boolean
}

function expiryPart(expiresAt: string, now: number): {
  text: string
  expired: boolean
} {
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return { text: '만료 시각을 알 수 없어요', expired: false }
  const remaining = at - now
  if (remaining <= 0) return { text: '만료됐어요', expired: true }
  const days = Math.floor(remaining / MS_PER_DAY)
  if (days >= 1) return { text: `${days}일 뒤 만료`, expired: false }
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)))
  return { text: `${hours}시간 뒤 만료`, expired: false }
}

function usePart(info: InviteCodeInfo): string {
  if (info.useCount === 0) {
    return info.maxUses === 1 ? '한 명만 참여할 수 있어요' : '아직 아무도 안 들어왔어요'
  }
  return `${info.useCount}명 참여함`
}

export function inviteCodeStatus(
  info: InviteCodeInfo,
  now: number
): InviteCodeStatus {
  const expiry = expiryPart(info.expiresAt, now)
  const spent = info.maxUses > 0 && info.useCount >= info.maxUses
  const line = spent
    ? `다 썼어요 · ${expiry.text}`
    : `${expiry.text} · ${usePart(info)}`
  return { line, expired: expiry.expired, spent }
}
