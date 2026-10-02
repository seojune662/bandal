import { expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthService } from '../../../src/main/features/account/authService'

function fixture() {
  const user = { id: 'one', email: 'one@example.test', user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/one' } }
  const session = { user, access_token: 'test-token' }
  const row = { id: user.id, nickname: 'learner', avatar_color: 'blue', avatar_emoji: '⭐' }
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }))
  let changed: (_event: string, next: typeof session | null) => void = () => {}
  const chain = { select: () => chain, eq: () => chain, maybeSingle }
  const client = { from: () => chain, auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (listener: typeof changed) => { changed = listener; return { data: { subscription: { unsubscribe() {} } } } },
    signOut: async () => { changed('SIGNED_OUT', null) }
  } } as unknown as SupabaseClient
  const auth = createAuthService({ client, onChanged: vi.fn(), destroySession: vi.fn(), openExternal: vi.fn() })
  return { auth, session, maybeSingle, change: (next: typeof session | null) => changed('USER_UPDATED', next) }
}

test('restores and refreshes provider photos, then clears them at logout', async () => {
  const { auth, session, change } = fixture()
  expect((await auth.restore()).avatarUrl).toBe(session.user.user_metadata.avatar_url)
  change({ ...session, user: { ...session.user, user_metadata: { avatar_url: 'https://k.kakaocdn.net/new' } } })
  await vi.waitFor(() => expect(auth.getState().avatarUrl).toBe('https://k.kakaocdn.net/new'))
  await auth.signOut()
  expect(auth.getState()).toMatchObject({ phase: 'signed-out', profile: null, email: null, avatarUrl: null })
})
test('a late profile load cannot restore the previous account after logout', async () => {
  const { auth, maybeSingle } = fixture()
  let resolve!: (value: any) => void
  maybeSingle.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const restoring = auth.restore()
  await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalled())
  await auth.signOut()
  resolve({ data: { id: 'one', nickname: 'old' }, error: null })
  await restoring
  expect(auth.getState()).toMatchObject({ phase: 'signed-out', avatarUrl: null, profile: null })
})
