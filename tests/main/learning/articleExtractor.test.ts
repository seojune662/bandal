import { JSDOM } from 'jsdom'
import { describe, expect, test, vi } from 'vitest'
vi.mock('electron', () => ({ session: { fromPartition: vi.fn() }, WebContentsView: vi.fn() }))
import { session, WebContentsView } from 'electron'
import {
  ARTICLE_EXTRACTION_SOURCE, buildArticleSnapshot, createArticleExtractor,
  isPublicArticleAddress, matchArticleWords, validatePublicArticleUrl,
  type ArticlePageContents, type RawLearningArticle
} from '../../../src/main/features/learning/articleExtractor'

const paragraph = 'The city is changing as people work together to build a better future. They have new ideas for energy and transport, and the local community can learn from the experience. A careful article explains how the change will affect their daily lives. We are looking at the results with scientists who study the climate and share their findings with the public.'
const raw: RawLearningArticle = { title: 'Cities and climate', paragraphs: [paragraph, paragraph], language: 'en-US' }
const now = new Date('2026-10-04T00:00:00.000Z')

describe('article provenance and lexical matches', () => {
  test('segments canonical text without losing exact sentence offsets or metadata', () => {
    const article = buildArticleSnapshot({ ...raw, canonicalUrl: 'https://example.org/story?utm_source=news', byline: ' Author ' }, 'https://example.org/story?utm_source=search#section', 'public', now)
    expect(article).toMatchObject({ sourceUrl: 'https://example.org/story', canonicalUrl: 'https://example.org/story', byline: 'Author', fetchedAt: now.toISOString(), access: 'public', language: 'en' })
    expect(article.contentHash).toHaveLength(64)
    for (const p of article.paragraphs) for (const sentence of p.sentences) {
      expect(p.text.slice(sentence.start, sentence.end)).toBe(sentence.text)
    }
    expect(buildArticleSnapshot(raw, 'https://example.org/story', 'public', now).contentHash).toBe(article.contentHash)
  })

  test('matches whole words, explicit forms and phrases with the original source slice', () => {
    const article = buildArticleSnapshot({ ...raw, paragraphs: [`Art appears in an article about cities. The city is changing as people set off for work. ${paragraph}`] }, 'https://example.org/story', 'public', now)
    const matches = matchArticleWords(article, [
      { id: 'art', surface: 'art' }, { id: 'city', surface: 'city', forms: ['cities'] },
      { id: 'phrase', surface: 'set off' }, { id: 'missing', surface: 'transportation' }
    ])
    expect(matches.filter(match => match.wordId === 'art')).toHaveLength(1)
    expect(matches.some(match => match.wordId === 'missing')).toBe(false)
    expect(matches.find(match => match.wordId === 'phrase')?.surface).toBe('set off')
    expect(matches.filter(match => match.wordId === 'city').map(match => match.surface)).toEqual(['city', 'city', 'cities'])
    for (const match of matches) {
      const p = article.paragraphs.find(p => p.id === match.paragraphId)!
      expect(p.text.slice(match.start, match.end)).toBe(match.surface)
      expect(p.sentences.find(sentence => sentence.id === match.sentenceId)?.text).toBe(match.sentence)
    }
  })

  test('rejects access blockers, short/non-English bodies and unbounded content', () => {
    expect(() => buildArticleSnapshot({ ...raw, blocked: true }, 'https://example.org/story', 'public')).toThrow('구독')
    expect(() => buildArticleSnapshot({ ...raw, language: 'fr' }, 'https://example.org/story', 'public')).toThrow('영어')
    expect(() => buildArticleSnapshot({ ...raw, paragraphs: ['A login page.'] }, 'https://example.org/story', 'public')).toThrow('본문')
    expect(() => buildArticleSnapshot({ ...raw, paragraphs: ['가나다 '.repeat(200)] }, 'https://example.org/story', 'public')).toThrow('영어')
    expect(() => buildArticleSnapshot({ ...raw, paragraphs: [paragraph.repeat(1_000)] }, 'https://example.org/story', 'public')).toThrow('너무 길어요')
  })

  test('runs Readability against a clone and returns text without changing the source DOM', () => {
    const dom = new JSDOM(`<html lang="en"><head><title>Article fixture</title></head><body><nav>Menu</nav><article><h1>Cities and climate</h1>${Array.from({ length: 5 }, () => `<p>${paragraph}</p>`).join('')}</article><footer>Ads</footer></body></html>`, { url: 'https://example.org/story', runScripts: 'outside-only' })
    const before = dom.window.document.documentElement.outerHTML
    const extracted = dom.window.eval(ARTICLE_EXTRACTION_SOURCE) as RawLearningArticle
    expect(extracted.paragraphs.join(' ')).toContain('local community')
    expect(extracted.paragraphs.join(' ')).not.toContain('Menu')
    expect(dom.window.document.documentElement.outerHTML).toBe(before)
    expect(buildArticleSnapshot(extracted, 'https://example.org/story', 'public').paragraphs.length).toBeGreaterThan(0)
    dom.window.close()
  })
})

describe('public URL boundary', () => {
  test.each(['http://localhost/story', 'https://10.0.0.1/story', 'http://127.0.0.1/story', 'https://[::1]/story', 'https://user:pass@example.org/story', 'file:///tmp/story', 'https://example.org:8443/story', 'https://example.local/story'])('rejects private or credentialed URL %s', async url => {
    await expect(validatePublicArticleUrl(url, async () => [{ address: '93.184.216.34' }])).rejects.toThrow()
  })
  test('rejects a public-looking host with any private DNS answer', async () => {
    await expect(validatePublicArticleUrl('https://news.example.org/story', async () => [{ address: '93.184.216.34' }, { address: '192.168.1.1' }])).rejects.toThrow('비공개')
    await expect(validatePublicArticleUrl('https://news.example.org/story#x', async () => [{ address: '93.184.216.34' }])).resolves.toBe('https://news.example.org/story')
  })
  test.each(['0.0.0.0', '169.254.169.254', '100.64.0.1', '192.0.2.1', '224.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1'])('recognizes nonpublic address %s', address => expect(isPublicArticleAddress(address)).toBe(false))
})

describe('extractor lifecycle', () => {
  function contents() {
    let url = 'https://example.org/story'
    return { getURL: () => url, isDestroyed: () => false,
      loadURL: vi.fn(async (next: string) => { url = next }),
      executeJavaScriptInIsolatedWorld: vi.fn(async () => raw) } satisfies ArticlePageContents
  }
  test('uses an anonymous page for each URL and closes it after verification', async () => {
    const wc = contents(), close = vi.fn(), make = vi.fn(() => ({ contents: wc, close }))
    const extractor = createArticleExtractor({ validateUrl: async url => url, createPublicPage: make, now: () => now })
    expect((await extractor.extractUrl('https://example.org/story')).access).toBe('public')
    expect(make.mock.calls[0]?.[0]).toMatch(/^bandal-learning-extract-/)
    expect(wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(1001, [{ code: ARTICLE_EXTRACTION_SOURCE }])
    expect(close).toHaveBeenCalledOnce()
  })
  test('reads only the explicit registered source tab without navigating or closing it', async () => {
    const wc = contents(), make = vi.fn()
    const extractor = createArticleExtractor({ validateUrl: async url => url, resolveSourceTab: id => id === 'source' ? wc : null, createPublicPage: make })
    expect((await extractor.extractSourceTab('source')).access).toBe('source-tab')
    expect(wc.loadURL).not.toHaveBeenCalled()
    expect(make).not.toHaveBeenCalled()
    await expect(extractor.extractSourceTab('unknown')).rejects.toThrow('찾지 못했어요')
  })
  test('rechecks credential boundaries even after approving the same public origin', async () => {
    let onRequest: ((details: { url: string; resourceType: string }, callback: (result: { cancel?: boolean }) => void) => void) | undefined
    const anonymousSession = {
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setProxy: vi.fn(), on: vi.fn(),
      webRequest: { onBeforeRequest: (handler: typeof onRequest | null) => { if (handler) onRequest = handler } },
      closeAllConnections: vi.fn(), clearStorageData: vi.fn(), clearCache: vi.fn()
    }
    const wc = { ...contents(), setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(), on: vi.fn(), setAudioMuted: vi.fn(), close: vi.fn() }
    vi.mocked(session.fromPartition).mockReturnValue(anonymousSession as never)
    vi.mocked(WebContentsView).mockImplementation(function () { return { webContents: wc } } as never)
    wc.loadURL.mockImplementation(async () => {
      const request = (url: string) => new Promise<{ cancel?: boolean }>(resolve => onRequest!({ url, resourceType: 'mainFrame' }, resolve))
      expect(await request('https://example.org/story')).toEqual({ cancel: false })
      expect(await request('https://user:password@example.org/other')).toEqual({ cancel: true })
    })
    await createArticleExtractor({ validateUrl: async url => url }).extractUrl('https://example.org/story')
    expect(wc.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(wc.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp')
    expect(anonymousSession.setProxy).toHaveBeenCalledWith({ mode: 'fixed_servers', proxyRules: expect.stringMatching(/^http=127\.0\.0\.1:\d+;https=127\.0\.0\.1:\d+$/u), proxyBypassRules: '<-loopback>' })
  })
  test('cleans session and proxy initialization failures before any page navigation', async () => {
    const anonymousSession = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
      setProxy: vi.fn(async () => { throw new Error('proxy initialization failed') }),
      webRequest: { onBeforeRequest: vi.fn() }, closeAllConnections: vi.fn(), clearStorageData: vi.fn(), clearCache: vi.fn() }
    vi.mocked(session.fromPartition).mockReturnValue(anonymousSession as never)
    await expect(createArticleExtractor({ validateUrl: async url => url }).extractUrl('https://example.org/story')).rejects.toThrow('proxy initialization failed')
    expect(anonymousSession.closeAllConnections).toHaveBeenCalledOnce()
    expect(anonymousSession.clearStorageData).toHaveBeenCalledOnce()
    expect(anonymousSession.clearCache).toHaveBeenCalledOnce()
  })
  test('closes asynchronously created pages that finish after the extraction timeout', async () => {
    let finish: (page: { contents: ArticlePageContents; close: () => void }) => void = () => {}
    const close = vi.fn(), wc = contents()
    const extractor = createArticleExtractor({ validateUrl: async url => url,
      createPublicPage: () => new Promise(resolve => { finish = resolve }), timeoutMs: 5 })
    await expect(extractor.extractUrl('https://example.org/story')).rejects.toThrow('시간이 초과')
    finish({ contents: wc, close })
    await new Promise(resolve => setImmediate(resolve))
    expect(close).toHaveBeenCalledOnce()
    expect(wc.loadURL).not.toHaveBeenCalled()
  })
  test('checks final redirect URL and aborts/cleans up stalled extraction', async () => {
    const wc = contents(), close = vi.fn()
    wc.loadURL.mockImplementation(async () => { Object.assign(wc, { getURL: () => 'http://127.0.0.1/private' }) })
    const validate = vi.fn(async (url: string) => { if (url.includes('127.')) throw new Error('private redirect'); return url })
    const extractor = createArticleExtractor({ validateUrl: validate, createPublicPage: () => ({ contents: wc, close }) })
    await expect(extractor.extractUrl('https://example.org/story')).rejects.toThrow('private redirect')
    expect(close).toHaveBeenCalledOnce()
    const slow = contents(), cleanup = vi.fn()
    slow.executeJavaScriptInIsolatedWorld.mockImplementation(() => new Promise(() => {}))
    const timeout = createArticleExtractor({ validateUrl: async url => url, createPublicPage: () => ({ contents: slow, close: cleanup }), timeoutMs: 5 })
    await expect(timeout.extractUrl('https://example.org/story')).rejects.toThrow('시간이 초과')
    expect(cleanup).toHaveBeenCalledOnce()
    const disposed = createArticleExtractor({ validateUrl: async url => url, createPublicPage: () => ({ contents: slow, close: cleanup }) })
    const pending = disposed.extractUrl('https://example.org/story')
    disposed.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(disposed.extractUrl('https://example.org/story')).rejects.toThrow('종료')
  })
})
