import { beforeEach, expect, test, vi } from 'vitest'
import type { BrowserAuthFallback } from '../../../src/shared/types/browserAuth'
import type { BrowserAuthEvent } from '../../../src/shared/ipc/events'
import { createBrowserAuthForwarder } from '../../../src/renderer/src/features/browser/browserAuthForwarding'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn() }))

let guests: Array<{ tabId: string; profileId: string; isPrivate: boolean }>
let notices: Record<string, BrowserAuthFallback | null>
let forwarding: ReturnType<typeof createBrowserAuthForwarder>
const event = (patch: Partial<BrowserAuthEvent> = {}): BrowserAuthEvent => ({
  tabId: 'tab', webContentsId: 41, sourceWebContentsId: 41,
  documentId: 'document-one', status: 'blocked', reason: 'insecure-browser',
  restartUrl: 'https://chatgpt.com/', origin: 'https://accounts.google.com', path: '/denied',
  ...patch
})

beforeEach(() => {
  guests = [{ tabId: 'tab', profileId: 'default', isPrivate: false }]
  notices = {}
  forwarding = createBrowserAuthForwarder(() => guests, (tabId, url) => { notices[tabId] = url })
})

test('a native popup refusal waits for adoption and survives registration of its actual document', () => {
  guests = []
  forwarding.receive(event())
  expect(notices.tab).toBeUndefined()
  guests = [{ tabId: 'tab', profileId: 'school', isPrivate: false }]
  forwarding.register('tab', 41, 'document-one')
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
})

test('future document events wait for its native state and retired documents cannot change its notice', () => {
  forwarding.register('tab', 41, 'document-one')
  forwarding.receive(event())
  forwarding.receive(event({ documentId: 'document-two', status: 'clear' }))
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
  forwarding.register('tab', 41, 'document-two')
  expect(notices.tab).toBeNull()
  forwarding.receive(event({ documentId: 'document-two', restartUrl: 'https://drive.google.com/' }))
  forwarding.receive(event({ status: 'clear' }))
  forwarding.receive(event())
  forwarding.register('tab', 41, 'document-one')
  expect(notices.tab?.restartUrl).toBe('https://drive.google.com/')
})

test('a blocked event for a new document cannot appear before that document is current', () => {
  forwarding.register('tab', 41, 'document-one')
  forwarding.receive(event({ documentId: 'document-two' }))
  expect(notices.tab).toBeUndefined()
  forwarding.register('tab', 41, 'document-two')
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
})

test('same-document recovery clears the notice and a later genuine refusal may appear again', () => {
  forwarding.register('tab', 41, 'document-one')
  forwarding.receive(event())
  forwarding.receive(event({ status: 'clear' }))
  expect(notices.tab).toBeNull()
  forwarding.receive(event())
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
})

test('standalone popup recovery only clears its own source and ignores retired source documents', () => {
  forwarding.register('tab', 41, 'document-one')
  forwarding.receive(event())
  forwarding.receive(event({ sourceWebContentsId: 52, documentId: 'popup-one', restartUrl: 'https://drive.google.com/' }))
  expect(notices.tab?.restartUrl).toBe('https://drive.google.com/')
  forwarding.receive(event({ sourceWebContentsId: 52, documentId: 'popup-two', status: 'clear' }))
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
  forwarding.receive(event({ sourceWebContentsId: 52, documentId: 'popup-two', restartUrl: 'https://drive.google.com/' }))
  forwarding.receive(event({ sourceWebContentsId: 52, documentId: 'popup-one', status: 'clear' }))
  expect(notices.tab?.restartUrl).toBe('https://drive.google.com/')
  forwarding.receive(event({ status: 'clear' }))
  expect(notices.tab?.restartUrl).toBe('https://drive.google.com/')
})

test('profile replacement immediately retires the old native page and pending events', () => {
  forwarding.register('tab', 41, 'document-one')
  forwarding.receive(event())
  forwarding.receive(event({ documentId: 'document-two' }))
  guests = [{ tabId: 'tab', profileId: 'personal', isPrivate: false }]
  forwarding.reconcile()
  expect(notices.tab).toBeNull()
  forwarding.receive(event())
  forwarding.register('tab', 41, 'document-two')
  expect(notices.tab).toBeNull()
  forwarding.receive(event({ webContentsId: 63, sourceWebContentsId: 63, documentId: 'new-profile' }))
  forwarding.register('tab', 63, 'new-profile')
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
  forwarding.receive(event({ status: 'clear' }))
  forwarding.retire('tab', 41)
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
})

test('a closed tab cannot recover an old pending refusal when recreated', () => {
  forwarding.receive(event())
  guests = []
  forwarding.reconcile()
  guests = [{ tabId: 'tab', profileId: 'default', isPrivate: false }]
  forwarding.register('tab', 41, 'document-one')
  expect(notices.tab).toBeUndefined()
})

test('events without a tab id use only a confirmed native target', () => {
  forwarding.register('tab', 41, 'document-one')
  const { tabId: _tabId, ...withoutTab } = event()
  forwarding.receive(withoutTab)
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
  forwarding.receive({ ...withoutTab, webContentsId: 73, status: 'clear' })
  expect(notices.tab?.restartUrl).toBe('https://chatgpt.com/')
})


test('the visible source retains its supervised refusal reason until that source clears', () => {
  forwarding.register('tab', 41, 'document-one')
  forwarding.receive(event())
  forwarding.receive(event({ sourceWebContentsId: 52, documentId: 'supervised-popup', reason: 'supervised-account' }))
  expect(notices.tab).toEqual({ restartUrl: 'https://chatgpt.com/', reason: 'supervised-account' })
  forwarding.receive(event({ sourceWebContentsId: 52, documentId: 'supervised-popup', status: 'clear' }))
  expect(notices.tab).toEqual({ restartUrl: 'https://chatgpt.com/', reason: 'insecure-browser' })
})
