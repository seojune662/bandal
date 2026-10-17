import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const context = vi.hoisted(() => ({ directory: '', client: null as any }))
vi.mock('electron', () => ({ app: { getPath: () => context.directory }, shell: { openExternal: vi.fn() } }))
vi.mock('../../../src/main/lib/safeStorageGate', () => ({ runtimeSafeStorage: () => ({ isEncryptionAvailable: () => false }) }))
vi.mock('../../../src/main/features/account/supabaseClient', () => ({ createSupabaseClient: () => context.client }))
import { createAccountRuntime } from '../../../src/main/features/account/accountRuntime'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))
test('remote clients require the verified bound identity even if the SDK retains another session', async () => {
  context.directory = mkdtempSync(join(tmpdir(), 'bandal-runtime-auth-')); roots.push(context.directory)
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222'
  let current = { user: { id: first }, access_token: 'first-token' }
  let changed: (event: string, session: typeof current) => void = () => {}
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: current.user.id, nickname: 'learner' }, error: null }) }
  context.client = { from: () => chain, auth: {
    getSession: async () => ({ data: { session: current }, error: null }),
    getUser: async () => ({ data: { user: current.user }, error: null }),
    onAuthStateChange: (listener: typeof changed) => { changed = listener; return { data: { subscription: { unsubscribe() {} } } } }
  } }
  const runtime = createAccountRuntime(vi.fn())
  expect(runtime.getClient()).toBeNull()
  await vi.waitFor(() => expect(runtime.auth().getState().localAccess?.requiresBindingConfirmation).toBe(true))
  expect(runtime.getClient()).toBeNull()
  await runtime.auth().confirmProfile(first)
  expect(runtime.getClient()).toBe(context.client)
  current = { user: { id: second }, access_token: 'other-token' }
  changed('SIGNED_IN', current)
  await vi.waitFor(() => expect(runtime.auth().getState().errorCode).toBe('profile-mismatch'))
  expect(runtime.auth().getState().localAccess?.allowed).toBe(true)
  expect(runtime.getClient()).toBeNull()
  runtime.dispose()
})
