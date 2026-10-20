import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createCommunityClient } from '../../../src/main/features/community/client'

function setup(signedIn: boolean, response: { data: unknown; error: { message: string } | null } = { data: null, error: null }) {
  const abortSignal = vi.fn().mockResolvedValue(response)
  const rpc = vi.fn().mockReturnValue({ abortSignal })
  const auth = { getSession: vi.fn().mockResolvedValue({ data: { session: signedIn ? { access_token: 'main-only-token' } : null }, error: null }) }
  const client = createCommunityClient({ getClient: () => ({ auth, rpc }) as unknown as SupabaseClient })
  return { client, rpc, abortSignal }
}

describe('community main-process client', () => {
  it('keeps unconfigured context usable and refuses all writes', async () => {
    const client = createCommunityClient({ getClient: () => null })
    await expect(client.request('context', {})).resolves.toEqual({ configured: false, signedIn: false, operator: false, campaign: null })
    await expect(client.request('posts', {})).rejects.toThrow('연결이 설정되지')
  })
  it('uses only the public metadata RPC for a signed-out context', async () => {
    const campaign = { id: 'study-tools-2026', title: '공모전', phase: 'upcoming' }
    const { client, rpc, abortSignal } = setup(false, { data: campaign, error: null })
    await expect(client.request('context', {})).resolves.toEqual({ configured: true, signedIn: false, operator: false, campaign })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('community_public_campaign', {})
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
  it('does not send content requests without a session', async () => {
    const { client, rpc } = setup(false)
    await expect(client.request('posts', {})).rejects.toThrow('로그인')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('dispatches an authenticated request without adding token or author fields', async () => {
    const { client, rpc } = setup(true, { data: { count: 1, active: true }, error: null })
    const input = { postId: '11111111-1111-4111-8111-111111111111', active: true }
    await expect(client.dispatch({ action: 'react', input })).resolves.toEqual({ count: 1, active: true })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('community_request', { action_input: 'react', input })
  })
  it('maps deadline failures into useful user-facing text', async () => {
    const { client } = setup(true, { data: null, error: { message: 'community_submission_locked' } })
    await expect(client.request('posts', {})).rejects.toThrow('접수가 마감되어')
  })
  it('does not expose unexpected SQL diagnostics or credentials', async () => {
    const { client } = setup(true, { data: null, error: { message: 'unknown SQL value main-only-token' } })
    await expect(client.request('posts', {})).rejects.toThrow('잠시 후 다시 시도')
    await expect(client.request('posts', {})).rejects.not.toThrow('main-only-token')
  })
  it('rejects unrecognized actions and oversized messages before remote dispatch', async () => {
    const { client, rpc } = setup(true)
    await expect(client.dispatch({ action: 'deleteEverything', input: {} } as never)).rejects.toThrow('다시 확인')
    await expect(client.request('comment', { postId: 'x', requestId: 'request-1', body: '한'.repeat(20_000) })).rejects.toThrow('너무 길어요')
    expect(rpc).not.toHaveBeenCalled()
  })
})
