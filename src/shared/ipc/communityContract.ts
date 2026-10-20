import type { CommunityRequest } from '../types/community'

export interface CommunityIpcContract {
  'community:request': { req: CommunityRequest; res: unknown }
  'community:takeIntent': {
    req: Record<string, never>
    res: { compose?: boolean; campaignId?: string; postId?: string } | null
  }
}

export const COMMUNITY_CHANNELS = ['community:request', 'community:takeIntent'] as const satisfies readonly (keyof CommunityIpcContract)[]
