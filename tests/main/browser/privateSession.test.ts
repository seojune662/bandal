import { EventEmitter } from 'node:events'
import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sessions: new Map<string, unknown>() }))
vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent/bandal-fixture' },
  session: { fromPartition: (partition: string) => mocks.sessions.get(partition) }
}))
class Session extends EventEmitter {
  clearStorageData = vi.fn(async () => {})
  clearCache = vi.fn(async () => {})
  clearAuthCache = vi.fn(async () => {})
  closeAllConnections = vi.fn(async () => {})
}
beforeEach(() => { vi.resetModules(); mocks.sessions.clear() })
test('private state is cleared only after its last page closes, with reopening held until cleanup', async () => {
  const session = new Session()
  let finish!: () => void
  session.clearStorageData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mocks.sessions.set('bandal-private', session)
  const profiles = await import('../../../src/main/features/browser/profiles')
  profiles.ensureProfileSession('default', true)
  profiles.registerGuestProfile(1, 'default', true)
  profiles.registerGuestProfile(2, 'default', true)
  profiles.forgetGuestProfile(1)
  expect(session.clearStorageData).not.toHaveBeenCalled()
  profiles.forgetGuestProfile(2)
  await Promise.resolve()
  expect(session.clearStorageData).toHaveBeenCalledTimes(1)
  let reopened = false
  const ready = profiles.prepareProfileSession('default', true).then(() => { reopened = true })
  await Promise.resolve()
  expect(reopened).toBe(false)
  finish()
  await ready
  expect(reopened).toBe(true)
  expect(session.clearCache).toHaveBeenCalledTimes(1)
  expect(session.clearAuthCache).toHaveBeenCalledTimes(1)
})
test('private account hints cannot survive cleanup or reuse of the same Electron session', async () => {
  const session = new Session(), normal = new Session()
  let finish!: () => void
  session.closeAllConnections.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  mocks.sessions.set('bandal-private', session)
  const profiles = await import('../../../src/main/features/browser/profiles')
  const accounts = await import('../../../src/main/features/browser/googleAccountNavigation')
  profiles.ensureProfileSession('default', true)
  profiles.registerGuestProfile(1, 'default', true)
  accounts.rememberGoogleAccountNavigation(session, 'https://www.google.com/?authuser=1')
  accounts.rememberGoogleAccountNavigation(normal, 'https://www.google.com/?authuser=2')

  profiles.forgetGuestProfile(1)
  expect(accounts.googleAccountNavigationUrl(session, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  finish()
  const reused = await profiles.prepareProfileSession('default', true)
  expect(reused).toBe(session)
  expect(accounts.googleAccountNavigationUrl(reused, 'https://www.youtube.com/')).toBe('https://www.youtube.com/')
  expect(accounts.googleAccountNavigationUrl(normal, 'https://www.youtube.com/')).toBe('https://www.youtube.com/?authuser=2')
})
test('closing a private page waits for its active download before clearing the session', async () => {
  const session = new Session(), download = new EventEmitter()
  mocks.sessions.set('bandal-private', session)
  const profiles = await import('../../../src/main/features/browser/profiles')
  profiles.ensureProfileSession('default', true)
  profiles.registerGuestProfile(1, 'default', true)
  session.emit('will-download', {}, download)
  profiles.forgetGuestProfile(1)
  await Promise.resolve()
  expect(session.clearStorageData).not.toHaveBeenCalled()
  download.emit('done')
  await profiles.prepareProfileSession('default', true)
  expect(session.clearStorageData).toHaveBeenCalledTimes(1)
})

test('a standalone popup inherits its profile and keeps private data alive after its opener closes', async () => {
  const session = new Session()
  mocks.sessions.set('bandal-private', session)
  const profiles = await import('../../../src/main/features/browser/profiles')
  profiles.ensureProfileSession('default', true)
  profiles.registerGuestProfile(1, 'default', true)
  profiles.inheritGuestProfile(2, 1)
  expect(profiles.guestProfile(2)).toEqual({ profileId: 'default', isPrivate: true })
  profiles.forgetGuestProfile(1)
  await Promise.resolve()
  expect(session.clearStorageData).not.toHaveBeenCalled()
  profiles.forgetGuestProfile(2)
  await profiles.prepareProfileSession('default', true)
  expect(session.clearStorageData).toHaveBeenCalledOnce()
})
