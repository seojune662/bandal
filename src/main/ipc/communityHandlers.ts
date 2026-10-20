import type { CommunityIpcContract } from '../../shared/ipc/communityContract'
import type { createCommunityClient } from '../features/community/client'

type Handler = <K extends keyof CommunityIpcContract>(channel: K, fn: (input: CommunityIpcContract[K]['req']) => CommunityIpcContract[K]['res'] | Promise<CommunityIpcContract[K]['res']>) => void

export function registerCommunityHandlers(handle: Handler, deps: { client: ReturnType<typeof createCommunityClient> }): void {
  handle('community:request', req => deps.client.dispatch(req))
}
