import { beforeEach, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ liveUrl: null as string | null, navUrl: 'https://nav.example/', flush: null as null | { result: { status: string }; ref: { courseId: string; relPath: string } } }))
vi.mock('../../../src/renderer/src/features/browser/guestActions', () => ({ guestActions: { currentUrl: () => state.liveUrl } }))
vi.mock('../../../src/renderer/src/features/browser/browserGuestsStore', () => ({ useBrowserGuests: { getState: () => ({ nav: { t1: { url: state.navUrl } } }) } }))
vi.mock('../../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ flushOpenNoteSession: async () => state.flush }))
vi.mock('../../../src/renderer/src/features/documents/saveRegistry', () => ({ flushDocumentSaves: vi.fn(async () => undefined) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn() }))
import { shareableFor } from '../../../src/renderer/src/app/ShareTabButton'

beforeEach(() => { state.liveUrl = null; state.navUrl = 'https://nav.example/'; state.flush = null })

test('a browser tab shares the live page link, falling back to the last navigation', async () => {
  const browser = shareableFor({ kind: 'browser', payload: { tabId: 't1', initialUrl: 'https://www.google.com' } })!
  expect(browser.label).toBe('링크 공유')
  expect(await browser.target()).toEqual({ kind: 'url', url: 'https://nav.example/' })
  state.liveUrl = 'https://live.example/page'
  expect(await browser.target()).toEqual({ kind: 'url', url: 'https://live.example/page' })
  state.liveUrl = 'about:blank'; state.navUrl = 'bandal://start'
  expect(typeof await browser.target()).toBe('string')
})

test('a note is shared under its current name once saved, and not when saving failed', async () => {
  const note = shareableFor({ kind: 'note', payload: { courseId: 'c1', relPath: 'old.md' } })!
  expect(await note.target()).toEqual({ kind: 'file', courseId: 'c1', relPath: 'old.md' })
  state.flush = { result: { status: 'saved' }, ref: { courseId: 'c1', relPath: 'renamed.md' } }
  expect(await note.target()).toEqual({ kind: 'file', courseId: 'c1', relPath: 'renamed.md' })
  state.flush = { result: { status: 'failed' }, ref: { courseId: 'c1', relPath: 'renamed.md' } }
  expect(typeof await note.target()).toBe('string')
})

test('a PDF shares its annotated copy; tabs without a file or link are not shareable', async () => {
  expect(await shareableFor({ kind: 'pdf', payload: { courseId: 'c1', relPath: 'a.pdf' } })!.target())
    .toEqual({ kind: 'file', courseId: 'c1', relPath: 'a.pdf', annotatedPdf: true })
  expect(shareableFor({ kind: 'board', payload: {} })).toBeNull()
  expect(shareableFor({ kind: 'chat', payload: { courseId: 'c1' } })).toBeNull()
  expect(shareableFor(null)).toBeNull()
})
