import { EventEmitter } from 'node:events'
import { JSDOM } from 'jsdom'
import { afterEach, expect, test, vi } from 'vitest'
import {
  attachEmbeddedAuthFallback, browserAuthDocumentId, createEmbeddedAuthObserver,
  EMBEDDED_AUTH_STATUS_PREFIX, inheritEmbeddedAuthSource
} from '../../../src/main/features/browser/embeddedAuth'
import type { BrowserAuthStatus } from '../../../src/shared/types/browserAuth'

const documents: JSDOM[] = []
function document(html: string, url = 'https://accounts.google.com/v3/signin/rejected') {
  const dom = new JSDOM(`<body>${html}</body>`, { url, runScripts: 'outside-only' })
  documents.push(dom)
  return dom
}
afterEach(() => { for (const dom of documents.splice(0)) dom.window.close() })
const refusal = '<main><h1>로그인할 수 없음</h1><p>브라우저 또는 앱이 안전하지 않을 수 있습니다.</p></main>'
const login = '<main><h1>Google 계정으로 로그인</h1><input type="email"></main>'

class Page extends EventEmitter {
  url = 'https://chatgpt.com/'
  mainFrame = {}
  loading = false
  dom = document(login, this.url)
  getURL = () => this.url
  isDestroyed = () => false
  isLoadingMainFrame = () => this.loading
  executeJavaScript = vi.fn(async (source: string): Promise<unknown> => this.dom.window.eval(source))
  navigate(url: string, html = login) {
    this.emit('will-navigate')
    this.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false }, url, false, true)
    this.url = url
    this.dom = document(html, url)
    this.dom.window.console.debug = (message: string) => this.signal(message)
    this.emit('did-navigate', {}, url)
    this.emit('dom-ready')
  }
  signal(message = EMBEDDED_AUTH_STATUS_PREFIX + browserAuthDocumentId(this.electron), frame = this.mainFrame) {
    this.emit('console-message', { message, frame }, 0, message)
  }
  get electron() { return this as unknown as Electron.WebContents }
}
function fixture() {
  const page = new Page(), statuses = vi.fn<(status: BrowserAuthStatus) => void>()
  attachEmbeddedAuthFallback(page.electron, statuses)
  return { page, statuses }
}
const blocked = (statuses: ReturnType<typeof fixture>['statuses']) => statuses.mock.calls.map(([status]) => status).filter(status => status.status === 'blocked')

test('delayed refusal reports its reason once and clears when the same document recovers', async () => {
  const { page, statuses } = fixture()
  page.navigate('https://auth.openai.com/authorize?state=old')
  expect(page.executeJavaScript).not.toHaveBeenCalled()
  page.navigate('https://accounts.google.com/v3/signin/challenge?state=secret')
  const documentId = browserAuthDocumentId(page.electron)
  await Promise.resolve()
  page.dom.window.document.body.innerHTML = refusal
  await vi.waitFor(() => expect(blocked(statuses)).toEqual([{
    status: 'blocked', documentId, reason: 'insecure-browser', restartUrl: 'https://chatgpt.com/',
    origin: 'https://accounts.google.com', path: '/v3/signin/challenge'
  }]))
  page.signal(); page.signal()
  await Promise.resolve()
  expect(blocked(statuses)).toHaveLength(1)
  page.dom.window.document.body.innerHTML = login
  await vi.waitFor(() => expect(statuses).toHaveBeenLastCalledWith({
    status: 'clear', documentId, origin: 'https://accounts.google.com', path: '/v3/signin/challenge'
  }))
  expect(JSON.stringify(statuses.mock.calls)).not.toContain('secret')
})

test('main navigation resets the document ID before native state listeners and ignores old snapshots', async () => {
  const { page, statuses } = fixture()
  let resolveOld!: (value: unknown) => void
  page.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  page.navigate('https://accounts.google.com/v3/signin/rejected?state=old', refusal)
  const oldId = browserAuthDocumentId(page.electron)
  let stateId = ''
  page.on('did-navigate', () => { stateId = browserAuthDocumentId(page.electron) })
  page.navigate('https://accounts.google.com/v3/signin/identifier?state=new')
  const newId = browserAuthDocumentId(page.electron)
  expect(newId).not.toBe(oldId)
  expect(stateId).toBe(newId)
  resolveOld({ documentId: oldId, reason: 'insecure-browser' })
  page.signal(EMBEDDED_AUTH_STATUS_PREFIX + oldId)
  await Promise.resolve()
  expect(blocked(statuses)).toEqual([])
  expect(statuses).toHaveBeenLastCalledWith({
    status: 'clear', documentId: newId, origin: 'https://accounts.google.com', path: '/v3/signin/identifier'
  })
})

test('a subframe signal cannot trigger a main-frame status and in-page recovery keeps document identity', async () => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com/v3/signin/rejected', refusal)
  await vi.waitFor(() => expect(blocked(statuses)).toHaveLength(1))
  const documentId = browserAuthDocumentId(page.electron)
  const count = page.executeJavaScript.mock.calls.length
  page.signal(undefined, {})
  expect(page.executeJavaScript).toHaveBeenCalledTimes(count)
  page.dom.window.history.pushState({}, '', '/v3/signin/identifier')
  page.url = page.dom.window.location.href
  page.dom.window.document.body.innerHTML = login
  page.emit('did-start-navigation', { url: page.url, isMainFrame: true, isSameDocument: true })
  page.emit('did-navigate-in-page', {}, page.url, true)
  await vi.waitFor(() => expect(statuses).toHaveBeenLastCalledWith({
    status: 'clear', documentId, origin: 'https://accounts.google.com', path: '/v3/signin/identifier'
  }))
  expect(browserAuthDocumentId(page.electron)).toBe(documentId)
})

test('newer recovery snapshots supersede an older pending refusal in the same document', async () => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com/v3/signin/rejected')
  await Promise.resolve()
  const documentId = browserAuthDocumentId(page.electron)
  let finishOld!: (value: unknown) => void
  page.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  page.signal()
  page.signal()
  await Promise.resolve()
  finishOld({ documentId, reason: 'insecure-browser' })
  await Promise.resolve()
  expect(blocked(statuses)).toEqual([])
})

test('a URL-only refusal updates the observer baseline so a later DOM recovery is reported', async () => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com/v3/signin/identifier',
    '<main><h1>Google 로그인</h1><p>브라우저 또는 앱이 안전하지 않을 수 있습니다.</p></main>')
  await Promise.resolve()
  expect(blocked(statuses)).toEqual([])
  const documentId = browserAuthDocumentId(page.electron)
  // Google can change its SPA route before replacing the contents. This read
  // used to change only main's reason, leaving the observer at its initial null.
  page.dom.window.history.pushState({}, '', '/v3/signin/rejected')
  page.url = page.dom.window.location.href
  page.emit('did-navigate-in-page', {}, page.url, true)
  await vi.waitFor(() => expect(blocked(statuses)).toEqual([expect.objectContaining({
    documentId, reason: 'insecure-browser'
  })]))
  page.dom.window.document.body.innerHTML = login
  await vi.waitFor(() => expect(statuses).toHaveBeenLastCalledWith(expect.objectContaining({
    status: 'clear', documentId
  })))
  page.dom.window.document.body.innerHTML = refusal
  await vi.waitFor(() => expect(blocked(statuses)).toHaveLength(2))
})

test.each(['did-stop-loading', 'did-fail-load'] as const)('a canceled navigation resumes its retained document after %s without dom-ready', async event => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com/v3/signin/rejected', refusal)
  await vi.waitFor(() => expect(blocked(statuses)).toHaveLength(1))
  const oldId = browserAuthDocumentId(page.electron)
  page.loading = true
  page.emit('did-start-navigation', { url: 'https://accounts.google.com/signin', isMainFrame: true, isSameDocument: false })
  const retainedId = browserAuthDocumentId(page.electron)
  expect(retainedId).not.toBe(oldId)
  expect(statuses.mock.lastCall?.[0].status).toBe('clear')
  // An abort from another attempt must not restore the old page over a new load.
  const attempts = page.executeJavaScript.mock.calls.length
  page.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://accounts.google.com/signin', true)
  expect(page.executeJavaScript).toHaveBeenCalledTimes(attempts)
  page.loading = false
  if (event === 'did-stop-loading') page.emit(event)
  else page.emit(event, {}, -3, 'ERR_ABORTED', 'https://accounts.google.com/signin', true)
  await vi.waitFor(() => expect(statuses).toHaveBeenLastCalledWith(expect.objectContaining({
    status: 'blocked', documentId: retainedId, reason: 'insecure-browser', path: '/v3/signin/rejected'
  })))
  // The renewed observer must continue clearing a recovered retained document.
  page.dom.window.document.body.innerHTML = login
  await vi.waitFor(() => expect(statuses).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'clear', documentId: retainedId })))
})

test('duplicate dom-ready events keep one observer and do not duplicate refusal or recovery reports', async () => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com/v3/signin/rejected', refusal)
  await vi.waitFor(() => expect(blocked(statuses)).toHaveLength(1))
  const observer = page.dom.window.__bandalEmbeddedAuthObserver
  page.emit('dom-ready'); page.emit('dom-ready')
  await Promise.resolve()
  expect(page.dom.window.__bandalEmbeddedAuthObserver).toBe(observer)
  expect(blocked(statuses)).toHaveLength(1)
  const count = statuses.mock.calls.length
  page.dom.window.document.body.innerHTML = login
  await vi.waitFor(() => expect(statuses).toHaveBeenCalledTimes(count + 1))
  expect(statuses.mock.lastCall?.[0].status).toBe('clear')
})

test('a nested login tab inherits its opener service across authentication redirects', async () => {
  const { page: parent } = fixture()
  parent.navigate('https://accounts.google.com/signin')
  const child = new Page(), statuses = vi.fn<(status: BrowserAuthStatus) => void>()
  child.url = 'about:blank'
  inheritEmbeddedAuthSource(child.electron, parent.electron)
  attachEmbeddedAuthFallback(child.electron, statuses)
  child.navigate('https://accounts.google.com/v3/signin/rejected?state=child', refusal)
  await vi.waitFor(() => expect(blocked(statuses)).toEqual([expect.objectContaining({ restartUrl: 'https://chatgpt.com/' })]))
})

test('ordinary pages cannot spoof a provider refusal and navigation errors stay harmless', () => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com.attacker.test/', refusal)
  page.signal()
  expect(page.executeJavaScript).not.toHaveBeenCalled()
  expect(blocked(statuses)).toEqual([])
})

test('closing a refused standalone source withdraws its notice without accessing destroyed contents', async () => {
  const { page, statuses } = fixture()
  page.navigate('https://accounts.google.com/v3/signin/rejected?state=secret', refusal)
  await vi.waitFor(() => expect(blocked(statuses)).toHaveLength(1))
  const documentId = browserAuthDocumentId(page.electron)
  page.isDestroyed = () => true
  page.getURL = () => { throw new Error('Object has been destroyed') }
  expect(() => page.emit('destroyed')).not.toThrow()
  expect(statuses).toHaveBeenLastCalledWith({
    status: 'clear', documentId, origin: 'https://accounts.google.com', path: '/v3/signin/rejected'
  })
  const calls = statuses.mock.calls.length
  page.signal()
  await Promise.resolve()
  expect(statuses).toHaveBeenCalledTimes(calls)
})

test.each([
  ['normal login with unsupported-browser help', `${login}<footer>지원되지 않는 브라우저에 대해 알아보기</footer>`],
  ['help link on error page', '<main><h1>로그인할 수 없음</h1><a>브라우저 또는 앱이 안전하지 않을 수 있습니다.</a><p>비밀번호를 확인하세요.</p></main>'],
  ['hidden rejection template', `${login}<div hidden>${refusal}</div>`],
  ['CSS-hidden rejection template', `${login}<div style="display:none">${refusal}</div>`],
  ['generic credential error', '<main><h1>로그인할 수 없음</h1><p>비밀번호를 확인하세요.</p></main>'],
  ['plain compatibility text on normal form', `${login}<p>브라우저 또는 앱이 안전하지 않을 수 있습니다.</p>`]
])('ignores %s', (_name, html) => {
  const dom = document(html, 'https://accounts.google.com/v3/signin/identifier')
  expect(dom.window.eval(createEmbeddedAuthObserver('document'))).toEqual({ documentId: 'document', reason: null })
})

test.each([
  ['https://accounts.google.com/v3/signin/rejected', refusal, 'insecure-browser'],
  ['https://accounts.google.com/v3/signin/challenge', '<main><h1>Couldn’t sign you in</h1><p>This browser or app may not be secure.</p></main>', 'insecure-browser'],
  ['https://accounts.google.com/signin/error', '<main><h1>Error 403</h1><p>disallowed_useragent</p></main>', 'disallowed-useragent'],
  ['https://accounts.google.com/signin?error=disallowed_useragent&state=secret', login, 'disallowed-useragent']
])('recognizes explicit refusal at %s', (url, html, reason) => {
  const dom = document(html, url)
  expect(dom.window.eval(createEmbeddedAuthObserver('document'))).toEqual({ documentId: 'document', reason })
})

test('replacing an observer disposes pending reports from its previous document token', async () => {
  const dom = document(login)
  const report = vi.fn()
  dom.window.console.debug = report
  dom.window.eval(createEmbeddedAuthObserver('old'))
  dom.window.document.body.innerHTML = refusal
  await Promise.resolve()
  expect(dom.window.eval(createEmbeddedAuthObserver('new'))).toEqual({ documentId: 'new', reason: 'insecure-browser' })
  dom.window.document.body.innerHTML = login
  await vi.waitFor(() => expect(report).toHaveBeenCalledExactlyOnceWith(EMBEDDED_AUTH_STATUS_PREFIX + 'new'))
  expect(dom.window.eval(createEmbeddedAuthObserver('new'))).toEqual({ documentId: 'new', reason: null })
})
