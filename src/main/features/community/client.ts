import type { SupabaseClient } from '@supabase/supabase-js'
import { COMMUNITY_ACTIONS, type CommunityAction, type CommunityApi, type CommunityCampaign, type CommunityRequest } from '../../../shared/types/community'
import { ValidationError } from '../../db/errors'

const MESSAGES: Record<string, string> = {
  sign_in_required: '커뮤니티를 이용하려면 로그인해 주세요.',
  community_not_found: '게시물을 찾을 수 없어요.',
  community_forbidden: '이 작업을 할 권한이 없어요.',
  community_invalid_input: '입력한 내용을 다시 확인해 주세요.',
  community_campaign_not_open: '지금은 공모 접수 기간이 아니에요.',
  community_submission_locked: '접수가 마감되어 제출 내용을 수정할 수 없어요.',
  community_schedule_locked: '접수 시작 후에는 접수 기간을 변경할 수 없어요.',
  community_results_not_ready: '접수 마감 후에 수상 결과를 공개할 수 있어요.',
  community_award_taken: '이미 같은 순위로 선정한 게시물이 있어요. 기존 선정을 해제한 뒤 다시 시도해 주세요.',
  community_idempotency_conflict: '이 요청의 내용이 달라졌어요. 화면을 새로 열고 다시 시도해 주세요.',
  community_rate_limited: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  account_deletion_in_progress: '계정 삭제가 진행 중이에요.',
  community_profile_required: '계정에서 닉네임을 먼저 정해 주세요.'
}

function problem(error: { message?: string | undefined }): ValidationError {
  const key = Object.keys(MESSAGES).find(candidate => error.message === candidate)
  return new ValidationError(key ? MESSAGES[key]! : '커뮤니티에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
}

/** All remote credentials stay in the existing account-owned main-process client. */
export function createCommunityClient(deps: { getClient(): SupabaseClient | null }) {
  async function request<K extends CommunityAction>(action: K, input: CommunityApi[K]['req']): Promise<CommunityApi[K]['res']> {
    if (!COMMUNITY_ACTIONS.includes(action) || !input || typeof input !== 'object' || Array.isArray(input))
      throw new ValidationError(MESSAGES.community_invalid_input!)
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 48_000)
      throw new ValidationError('내용이 너무 길어요. 글을 조금 줄여 주세요.')
    const client = deps.getClient()
    if (!client) {
      if (action === 'context') return { configured: false, signedIn: false, operator: false, campaign: null } as CommunityApi[K]['res']
      throw new ValidationError('커뮤니티 연결이 설정되지 않았어요.')
    }
    const session = await client.auth.getSession()
    if (session.error) throw problem(session.error)
    if (!session.data.session) {
      if (action !== 'context') throw new ValidationError(MESSAGES.sign_in_required!)
      const { data, error } = await client.rpc('community_public_campaign', {}).abortSignal(AbortSignal.timeout(15_000))
      if (error) throw problem(error)
      return { configured: true, signedIn: false, operator: false, campaign: data as CommunityCampaign | null } as CommunityApi[K]['res']
    }
    const { data, error } = await client.rpc('community_request', { action_input: action, input }).abortSignal(AbortSignal.timeout(20_000))
    if (error) throw problem(error)
    return data as CommunityApi[K]['res']
  }
  return {
    request,
    dispatch(req: CommunityRequest): Promise<unknown> {
      if (!req || typeof req !== 'object') throw new ValidationError(MESSAGES.community_invalid_input!)
      return request(req.action, req.input)
    }
  }
}
