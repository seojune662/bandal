export interface CommunityDeepLink { compose?: boolean; campaignId?: string; postId?: string }

/** Accept only navigation data. No query, credentials or executable URL reaches renderer. */
export function parseCommunityDeepLink(raw: string): CommunityDeepLink | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'bandal:' || url.hostname !== 'community' || url.username || url.password || url.port || url.search || url.hash) return null
    if (url.pathname === '' || url.pathname === '/') return {}
    const contest = /^\/contest\/([a-z0-9][a-z0-9-]{0,79})\/?$/.exec(url.pathname)
    if (contest) return { compose: true, campaignId: contest[1]! }
    const post = /^\/post\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i.exec(url.pathname)
    return post ? { postId: post[1]! } : null
  } catch { return null }
}
