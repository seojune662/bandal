import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLocalAccessStore } from '../../../src/main/features/account/localAccessStore'
import { createAuthService } from '../../../src/main/features/account/authService'
const firstUser = '11111111-1111-4111-8111-111111111111'
const secondUser = '22222222-2222-4222-8222-222222222222'
const roots: string[] = []
const root = () => { const value = mkdtempSync(join(tmpdir(), 'bandal-access-')); roots.push(value); return value }
afterEach(() => { roots.splice(0).forEach(value => rmSync(value, { recursive: true, force: true })) })

test('first ownership needs explicit confirmation, then offline access survives restart and expiry', () => {
  const directory = root(), receipt = createLocalAccessStore(directory)
  expect(receipt.state().allowed).toBe(false)
  receipt.acceptVerified(firstUser)
  expect(receipt.state()).toMatchObject({ allowed: false, requiresBindingConfirmation: true, pendingUserID: firstUser })
  expect(() => receipt.confirm(secondUser)).toThrow()
  receipt.confirm(firstUser)
  expect(createLocalAccessStore(directory).state()).toMatchObject({ allowed: true, boundUserID: firstUser })
  expect(receipt.canAccept(secondUser)).toBe(false)
  expect(() => receipt.acceptVerified(secondUser)).toThrow('profile-mismatch')
  receipt.lock()
  expect(createLocalAccessStore(directory).state()).toMatchObject({ allowed: false, boundUserID: firstUser })
})

test('upgrade retains previous binding but requires server verification once', () => {
  const directory = root()
  mkdirSync(join(directory, 'ipad-companion'))
  writeFileSync(join(directory, 'ipad-companion/preferences.json'), JSON.stringify({ boundUserID: firstUser, enabled: true }))
  const receipt = createLocalAccessStore(directory)
  expect(receipt.state()).toMatchObject({ allowed: false, boundUserID: firstUser })
  receipt.acceptVerified(firstUser)
  expect(receipt.state().allowed).toBe(true)
})

test('an expired server session does not revoke local access, explicit logout does', async () => {
  const receipt = createLocalAccessStore(root())
  receipt.acceptVerified(firstUser); receipt.confirm(firstUser)
  const client = { auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: new Error('offline') })), signOut: vi.fn(async () => {}) } } as unknown as SupabaseClient
  const auth = createAuthService({ localAccess: receipt, client, onChanged: vi.fn(), destroySession: vi.fn(), openExternal: vi.fn() })
  await auth.restore()
  expect(auth.getState()).toMatchObject({ phase: 'signed-out', localAccess: { allowed: true, boundUserID: firstUser } })
  await auth.signOut()
  expect(auth.getState().localAccess?.allowed).toBe(false)
})

test('a cached session cannot reopen a profile after explicit logout', async () => {
  const receipt = createLocalAccessStore(root())
  receipt.acceptVerified(firstUser); receipt.confirm(firstUser); receipt.lock()
  const getUser = vi.fn(async () => ({ data: { user: null }, error: new Error('invalid') }))
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: secondUser } } }, error: null }), getUser,
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } as unknown as SupabaseClient
  const auth = createAuthService({ localAccess: receipt, client, onChanged: vi.fn(), destroySession: vi.fn(), openExternal: vi.fn() })
  await auth.restore()
  expect(auth.getState()).toMatchObject({ phase: 'signed-out', localAccess: { allowed: false, boundUserID: firstUser } })
  expect(auth.userId()).toBeNull()
  expect(getUser).not.toHaveBeenCalled()
})

test('deletion locks durably, restores a definite refusal, and requires interactive login after an uncertain response', async () => {
  const directory = root(), receipt = createLocalAccessStore(directory)
  receipt.acceptVerified(firstUser); receipt.confirm(firstUser)
  const session = { access_token: 'test-token', user: { id: firstUser } }
  let changed: (event: string, value: typeof session) => void = () => {}
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { id: firstUser, nickname: 'learner' }, error: null }) }
  const getUser = vi.fn(async () => ({ data: { user: session.user }, error: null }))
  const client = { from: () => chain, auth: {
    getSession: async () => ({ data: { session }, error: null }), getUser,
    exchangeCodeForSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (listener: typeof changed) => { changed = listener; return { data: { subscription: { unsubscribe() {} } } } }
  } } as unknown as SupabaseClient
  const destroySession = vi.fn()
  const auth = createAuthService({ localAccess: receipt, client, onChanged: vi.fn(), destroySession, openExternal: vi.fn() })
  await auth.restore()
  const refused = auth.beginAccountDeletion()
  expect(createLocalAccessStore(directory).state().allowed).toBe(false)
  changed('TOKEN_REFRESHED', session)
  await Promise.resolve()
  await auth.handleDeepLink('bandal://auth/callback?code=late-link-during-deletion')
  expect(receipt.state().allowed).toBe(false)
  refused.cancel()
  expect(createLocalAccessStore(directory).state().allowed).toBe(true)
  const unknown = auth.beginAccountDeletion()
  unknown.uncertain()
  expect(auth.userId()).toBeNull()
  expect(auth.getState()).toMatchObject({ phase: 'error', localAccess: { allowed: false } })
  expect(destroySession).toHaveBeenCalled()
  getUser.mockClear()
  await auth.restore()
  expect(auth.getState().localAccess?.allowed).toBe(false)
  expect(getUser).not.toHaveBeenCalled()
  await auth.handleDeepLink('bandal://auth/callback?code=fresh-reauthentication')
  expect(auth.getState()).toMatchObject({ phase: 'signed-in', localAccess: { allowed: true } })
})

test('a delayed deletion refusal cannot undo a subsequent explicit logout', () => {
  const receipt = createLocalAccessStore(root())
  receipt.acceptVerified(firstUser); receipt.confirm(firstUser)
  const deletion = receipt.beginDeletion()
  receipt.lock()
  expect(() => deletion.cancel()).toThrow('account-changed')
  expect(receipt.state().allowed).toBe(false)
})

test.each([
  { verifiedAt: undefined, locked: undefined },
  { verifiedAt: undefined },
  { locked: undefined },
  { locked: 'false' },
  { verifiedAt: 'not-a-date' },
  { verifiedAt: 42 },
  { boundUserID: null, locked: false },
  { boundUserID: 'invalid-user' },
  { profileID: '../other-profile' }
])('incomplete or malformed persisted access fails closed: %j', patch => {
  const directory = root(), receipt = createLocalAccessStore(directory)
  receipt.acceptVerified(firstUser); receipt.confirm(firstUser)
  const path = join(directory, 'profile-access.json')
  const saved = { ...JSON.parse(readFileSync(path, 'utf8')), ...patch }
  writeFileSync(path, JSON.stringify(saved))
  expect(() => createLocalAccessStore(directory)).toThrow('로컬 계정 연결 기록')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(JSON.parse(JSON.stringify(saved)))
})

test('failed receipt writes preserve disk, memory and the pending confirmation for retry', () => {
  const directory = root(), receipt = createLocalAccessStore(directory)
  const temporary = join(directory, 'profile-access.json.tmp')
  receipt.acceptVerified(firstUser)
  const before = receipt.state()
  mkdirSync(temporary)
  expect(() => receipt.confirm(firstUser)).toThrow()
  expect(receipt.state()).toEqual(before)
  rmSync(temporary, { recursive: true })
  expect(createLocalAccessStore(directory).state()).toMatchObject({ allowed: false, boundUserID: null })
  receipt.confirm(firstUser)
  expect(receipt.state()).toMatchObject({ allowed: true, boundUserID: firstUser, requiresBindingConfirmation: false })

  mkdirSync(temporary)
  expect(() => receipt.lock()).toThrow()
  expect(receipt.state().allowed).toBe(true)
  rmSync(temporary, { recursive: true })
  expect(createLocalAccessStore(directory).state().allowed).toBe(true)
  receipt.lock()

  mkdirSync(temporary)
  expect(() => receipt.acceptVerified(firstUser)).toThrow()
  expect(receipt.state().allowed).toBe(false)
  rmSync(temporary, { recursive: true })
  expect(createLocalAccessStore(directory).state().allowed).toBe(false)
})
