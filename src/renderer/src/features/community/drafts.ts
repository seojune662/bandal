import type { CommunityAnswers, CommunityCategory, CommunityPostInput } from '../../../../shared/types/community'

export interface CommunityDraft {
  requestId: string
  title: string
  body: string
  answers: CommunityAnswers
  /** Persist the exact attempt so a lost response can be recovered before any edits. */
  submission?: CommunityPostInput
  commentSubmission?: { requestId: string; body: string }
}
const memory = new Map<string, CommunityDraft>()

export function draftKey(userId: string | null, category: CommunityCategory, campaignId?: string, postId?: string): string {
  return `bandal:community:draft:${userId ?? 'guest'}:${category}:${campaignId ?? '-'}:${postId ?? 'new'}`
}

export function newDraft(): CommunityDraft {
  return { requestId: crypto.randomUUID(), title: '', body: '', answers: { audience: '', problem: '', workflow: '', example: '' } }
}

export function readDraft(key: string): CommunityDraft | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved && typeof saved === 'object') {
      const value = saved as Partial<CommunityDraft>
      if (typeof value.requestId === 'string' && typeof value.title === 'string' && typeof value.body === 'string' && value.answers &&
        ['audience', 'problem', 'workflow', 'example'].every(field => typeof value.answers?.[field as keyof CommunityAnswers] === 'string')) {
        const result: CommunityDraft = { requestId: value.requestId, title: value.title, body: value.body, answers: value.answers }
        const submission = value.submission
        if (submission && typeof submission === 'object' && typeof submission.requestId === 'string' && typeof submission.title === 'string' && typeof submission.body === 'string' &&
          ['contest', 'study', 'feedback'].includes(submission.category)) result.submission = submission
        if (value.commentSubmission && typeof value.commentSubmission.requestId === 'string' && typeof value.commentSubmission.body === 'string') result.commentSubmission = value.commentSubmission
        return result
      }
    }
  } catch { /* A session copy remains usable if local storage is unavailable. */ }
  return memory.get(key) ?? null
}

export function saveDraft(key: string, draft: CommunityDraft): boolean {
  memory.set(key, draft)
  try { localStorage.setItem(key, JSON.stringify(draft)); return true } catch { return false }
}

export function clearDraft(key: string): void {
  memory.delete(key)
  try { localStorage.removeItem(key) } catch { /* No persisted draft to remove. */ }
}

/** Only anonymous drafts may move to the account that completes that login. */
export function transferGuestDraft(userId: string, category: CommunityCategory, campaignId?: string): void {
  const source = draftKey(null, category, campaignId)
  const target = draftKey(userId, category, campaignId)
  const draft = readDraft(source)
  if (!draft || readDraft(target)) return
  if (saveDraft(target, draft)) clearDraft(source)
}

export function postInput(draft: CommunityDraft, category: CommunityCategory, campaignId?: string, id?: string): CommunityPostInput {
  return {
    requestId: draft.requestId, category, title: draft.title.trim(), body: draft.body.trim(),
    ...(id ? { id } : {}),
    ...(category === 'contest' ? {
      ...(campaignId ? { campaignId } : {}),
      answers: Object.fromEntries(Object.entries(draft.answers).map(([key, value]) => [key, value.trim()])) as unknown as CommunityAnswers
    } : {})
  }
}

export function samePostContent(left: CommunityPostInput, right: CommunityPostInput): boolean {
  return left.category === right.category && left.campaignId === right.campaignId && left.title === right.title && left.body === right.body &&
    ['audience', 'problem', 'workflow', 'example'].every(field => left.answers?.[field as keyof CommunityAnswers] === right.answers?.[field as keyof CommunityAnswers])
}
