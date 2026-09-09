import type { FriendEntry } from '../types/group'

/** One badge per conversation, regardless of how many messages it contains. */
export function friendAttentionCount(friends: readonly FriendEntry[]): number {
  return friends.reduce((count, friend) => count + (
    friend.status === 'pending'
      ? Number(friend.direction === 'incoming')
      : Number(friend.hasUnread ?? (friend.unread ?? 0) > 0)
  ), 0)
}
