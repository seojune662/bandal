export type CommunityCategory = 'contest' | 'study' | 'feedback'
export type CommunityCampaignPhase = 'draft' | 'upcoming' | 'open' | 'judging' | 'results' | 'closed'
export type CommunityDevelopmentStatus = 'reviewing' | 'planned' | 'developing' | 'available' | 'not-planned'
export interface CommunityCampaign {
  id: string
  title: string
  summary: string
  published: boolean
  resultsPublished: boolean
  closed: boolean
  phase: CommunityCampaignPhase
  startsAt: string | null
  endsAt: string | null
  resultsAt: string | null
  rules: string
}
export interface CommunityAnswers { audience: string; problem: string; workflow: string; example: string }
export interface CommunityPost {
  id: string
  authorId: string | null
  authorName: string
  category: CommunityCategory
  campaignId: string | null
  title: string
  body: string
  answers: CommunityAnswers | null
  pinned: boolean
  hidden: boolean
  reactionCount: number
  reacted: boolean
  commentCount: number
  createdAt: string
  updatedAt: string
  editable: boolean
  award: 1 | 2 | null
  developmentStatus: CommunityDevelopmentStatus | null
  developmentNote: string
}
export interface CommunityComment {
  id: string; authorId: string | null; authorName: string; body: string; hidden: boolean; createdAt: string
}
export interface CommunityReport {
  id: string; postId: string; commentId: string | null; reason: string; createdAt: string; resolved: boolean
}
export interface CommunityContext {
  configured: boolean; signedIn: boolean; operator: boolean; campaign: CommunityCampaign | null
}
export interface CommunityPostInput {
  id?: string
  requestId: string
  category: CommunityCategory
  campaignId?: string
  title: string
  body: string
  answers?: CommunityAnswers
}
export interface CommunityApi {
  context: { req: Record<string, never>; res: CommunityContext }
  posts: { req: { category?: CommunityCategory; cursor?: string }; res: { posts: CommunityPost[]; nextCursor: string | null } }
  post: { req: { id: string }; res: { post: CommunityPost; comments: CommunityComment[] } }
  savePost: { req: CommunityPostInput; res: CommunityPost }
  comment: { req: { postId: string; requestId: string; body: string }; res: CommunityComment }
  react: { req: { postId: string; active: boolean }; res: { count: number; active: boolean } }
  report: { req: { postId: string; commentId?: string; reason: string }; res: { ok: true } }
  moderate: { req: { postId: string; action: 'pin' | 'unpin' | 'hide' | 'restore' | 'hideComment' | 'restoreComment'; commentId?: string }; res: { ok: true } }
  reports: { req: Record<string, never>; res: CommunityReport[] }
  resolveReport: { req: { id: string }; res: { ok: true } }
  updateCampaign: { req: { id: string; title: string; summary: string; rules: string; startsAt: string | null; endsAt: string | null; resultsAt: string | null; published: boolean; resultsPublished: boolean; closed: boolean }; res: CommunityCampaign }
  reviewPost: { req: { postId: string; award: 1 | 2 | null; developmentStatus: CommunityDevelopmentStatus | null; developmentNote: string }; res: CommunityPost }
}
export type CommunityAction = keyof CommunityApi
export type CommunityRequest = { [K in CommunityAction]: { action: K; input: CommunityApi[K]['req'] } }[CommunityAction]
export const COMMUNITY_ACTIONS: readonly CommunityAction[] = ['context', 'posts', 'post', 'savePost', 'comment', 'react', 'report', 'moderate', 'reports', 'resolveReport', 'updateCampaign', 'reviewPost']
export const COMMUNITY_CATEGORY_LABELS: Record<CommunityCategory, string> = { contest: '공모 참여', study: '공부법 공유', feedback: '질문과 피드백' }
export const COMMUNITY_DEVELOPMENT_LABELS: Record<CommunityDevelopmentStatus, string> = { reviewing: '개발 검토 중', planned: '개발 예정', developing: '개발 중', available: '사용 가능', 'not-planned': '개발 보류' }
