import { expect, test } from 'vitest'
import { friendAttentionCount } from '../../src/shared/group/friendAttention'
import type { FriendEntry } from '../../src/shared/types/group'

function friend(unread: number, overrides: Partial<FriendEntry> = {}): FriendEntry {
  return { userId: 'id', nickname: '친구', avatarColor: '#fff', avatarEmoji: '🌙', status: 'accepted', direction: 'outgoing', unread, ...overrides }
}
test('attention badge counts conversations and incoming requests, never message count', () => {
  expect(friendAttentionCount([friend(99), friend(2), friend(0)])).toBe(2)
  expect(friendAttentionCount([friend(0, { status: 'pending', direction: 'incoming' }), friend(0, { status: 'pending', direction: 'outgoing' }), friend(5)])).toBe(2)
  expect(friendAttentionCount([friend(4, { hasUnread: false })])).toBe(0)
})
