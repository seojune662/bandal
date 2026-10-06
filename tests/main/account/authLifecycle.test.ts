import { expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthService } from '../../../src/main/features/account/authService'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const session = { access_token: 'token', user: { id: 'one', email: 'one@example.test' } }
  const getSession = vi.fn(async () => ({ data: { session }, error: null }))
  const exchangeCodeForSession = vi.fn(async () => ({ data: { session }, error: null }))
  const openExternal = vi.fn(async () => {})
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: 'one', nickname: 'learner' }, error: null }) }
  const client = { from: () => chain, auth: {
    getSession, exchangeCodeForSession,
    signInWithOAuth: async () => ({ data: { url: 'https://login.example.test' }, error: null }),
    signOut: async () => {},
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  } } as unknown as SupabaseClient
  const auth = createAuthService({ client, openExternal, destroySession: vi.fn(), onChanged: vi.fn() })
  return { auth, session, getSession, exchangeCodeForSession, openExternal }
}

test('logout invalidates a session lookup before profile loading begins', async () => {
  const { auth, session, getSession } = fixture()
  const response = deferred<{ data: { session: typeof session }; error: null }>()
  getSession.mockReturnValue(response.promise)
  const restoring = auth.restore()
  await auth.signOut()
  response.resolve({ data: { session }, error: null })
  await restoring
  expect(auth.getState().phase).toBe('signed-out')
  expect(auth.accessToken()).toBeNull()
})

test('logout invalidates an OAuth exchange already in flight', async () => {
  const { auth, session, exchangeCodeForSession } = fixture()
  const response = deferred<{ data: { session: typeof session }; error: null }>()
  exchangeCodeForSession.mockReturnValue(response.promise)
  const callback = auth.handleDeepLink('bandal://auth/callback?code=valid-code')
  await auth.signOut()
  response.resolve({ data: { session }, error: null })
  await callback
  expect(auth.getState().phase).toBe('signed-out')
  expect(auth.userId()).toBeNull()
})

test('a fast browser callback cannot be overwritten by the browser-open acknowledgment', async () => {
  const { auth, openExternal } = fixture()
  const opened = deferred<void>()
  openExternal.mockReturnValue(opened.promise)
  const signIn = auth.signIn('google')
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
  await auth.handleDeepLink('bandal://auth/callback?code=valid-code')
  opened.resolve()
  await signIn
  expect(auth.getState().phase).toBe('signed-in')
})
