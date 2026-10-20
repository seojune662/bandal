import { describe, expect, it } from 'vitest'
import { parseCommunityDeepLink } from '../../src/main/features/community/deepLink'

describe('community deep link navigation', () => {
  it('accepts home, contest and a specific post without running any action', () => {
    expect(parseCommunityDeepLink('bandal://community')).toEqual({})
    expect(parseCommunityDeepLink('bandal://community/contest/study-tools-2026')).toEqual({ compose: true, campaignId: 'study-tools-2026' })
    expect(parseCommunityDeepLink('bandal://community/post/11111111-1111-4111-8111-111111111111')).toEqual({ postId: '11111111-1111-4111-8111-111111111111' })
  })
  it('rejects remote URLs, auth callbacks, credentials, query, traversal and unknown routes', () => {
    for (const raw of ['https://community', 'bandal://auth/callback?code=x', 'bandal://user@community', 'bandal://community:443', 'bandal://community?token=x', 'bandal://community#x', 'bandal://community/contest/%2f', 'bandal://community/contest/../x', 'bandal://community/post/not-a-uuid', 'bandal://community/delete/all', 'not a url']) {
      expect(parseCommunityDeepLink(raw)).toBeNull()
    }
  })
})
