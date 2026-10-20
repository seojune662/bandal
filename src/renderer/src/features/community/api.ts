import type { CommunityAction, CommunityApi, CommunityRequest } from '../../../../shared/types/community'
import { invoke } from '../../lib/ipc'

export async function communityRequest<K extends CommunityAction>(action: K, input: CommunityApi[K]['req']): Promise<CommunityApi[K]['res']> {
  return await invoke('community:request', { action, input } as CommunityRequest) as CommunityApi[K]['res']
}

export function communityError(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.'
}
