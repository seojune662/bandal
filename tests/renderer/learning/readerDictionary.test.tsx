// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DictionaryEntry, DictionaryLookupResult } from '../../../src/shared/types/dictionary'
import type { LearningArticleSnapshot, LearningProjectSnapshot } from '../../../src/shared/types/learning'
import { LearningReader } from '../../../src/renderer/src/features/learning/LearningReader'
import { restoreReaderPosition } from '../../../src/renderer/src/features/learning/useReaderProgress'
import { readerSavedOccurrence, readerWordSelection } from '../../../src/renderer/src/features/learning/readerSelection'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import * as tabs from '../../../src/renderer/src/app/tabCommands'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
const binding = { courseId: 'course', rootRelPath: 'English' }
const source = { datasetVersion: 'koreader-dicts-en-ko-v1.2.0', headword: 'bank', url: 'https://en.wiktionary.org/wiki/bank#English' }
const text = 'Bank loans grow. People bank money. Cities adapt.'
const article = { id: 'article', title: 'Cities', sourceUrl: 'https://example.test/cities', siteName: 'Example', estimatedMinutes: 1, wordCount: 9, paragraphs: [{ id: 'p1', text, sentences: [{ id: 's1', text, start: 0, end: text.length }] }] } as LearningArticleSnapshot
const emptyLookup: DictionaryLookupResult = { status: 'not-found', entries: [] }
const entry = (id: string, headword: string, meaning: string, partOfSpeech = 'noun'): DictionaryEntry => ({ id, headword, partOfSpeech, pronunciation: '/bæŋk/', senses: [{ meaning }], source: { ...source, headword, url: `https://en.wiktionary.org/wiki/${headword}#English` } })
const bankEntries = [entry('bank-noun', 'bank', '은행'), entry('bank-verb', 'bank', '은행에 예금하다', 'verb')]
function project(): LearningProjectSnapshot {
  return { schemaVersion: 1, projectId: 'project', revision: 1, name: 'English', topic: 'Cities', level: 'intermediate', readingMinutes: 5, createdAt: 'now', updatedAt: 'now', articles: [], words: [], occurrences: [], artifacts: [], cards: [], quizAttempts: [], runs: [], history: [], exports: [], binding, recovery: 'none', warnings: [] }
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } { let resolve!: (value: T) => void; return { promise: new Promise(done => { resolve = done }), resolve } }
function render(value = project(), onUpdate = vi.fn(), active = true, visible = true): HTMLDivElement {
  let host = document.querySelector<HTMLDivElement>('#reader-host')
  if (!host) { host = document.createElement('div'); host.id = 'reader-host'; document.body.append(host); root = createRoot(host) }
  act(() => root!.render(<LearningReader project={value} article={article} active={active} visible={visible} onUpdate={onUpdate} onComplete={() => {}} onArticle={() => {}} />))
  return host
}
function setup(handler: (channel: string, input: Record<string, unknown>) => Promise<unknown>): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(handler); setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter); return invoke
}
function token(surface: string): HTMLElement { return [...document.querySelectorAll<HTMLElement>('.learning-reader-word')].find(item => item.textContent === surface)! }
function button(label: string): HTMLButtonElement { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)! }
async function click(element: HTMLElement): Promise<void> { await act(async () => { element.click() }) }
function input(value: string): void {
  const field = document.querySelector<HTMLInputElement>('[aria-label="저장할 뜻"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
}
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); setIpcAdapter(null); vi.restoreAllMocks(); vi.useRealTimers() })

describe('reader dictionary', () => {
  test('looks up without a mutation and saves the explicitly selected sense and part of speech', async () => {
    const state = project()
    state.words = [{ id: 'known-bank', surface: 'bank', lemma: 'bank', meaning: '나의 은행 뜻', pronunciation: '', partOfSpeech: 'noun', status: 'new', createdAt: 'now', updatedAt: 'now' }]
    const invoke = setup(async channel => channel === 'learning:lookupDictionary' ? { status: 'found', entries: bankEntries } : state)
    render(state)
    await click(token('bank'))
    expect(document.querySelector('.learning-dictionary-saved-meaning')?.textContent).toContain('나의 은행 뜻')
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['learning:lookupDictionary'])
    await click([...document.querySelectorAll<HTMLButtonElement>('.learning-dictionary-senses button')][1]!)
    await click(button('이 문맥도 담기'))
    expect(invoke).toHaveBeenCalledWith('learning:saveWord', expect.objectContaining({ meaning: '은행에 예금하다', lemma: 'bank', partOfSpeech: 'verb', dictionarySource: source, sourceRef: expect.objectContaining({ start: text.indexOf('bank'), end: text.indexOf('bank') + 4 }) }))
    expect(invoke.mock.calls.some(([channel]) => channel === 'learning:run')).toBe(false)
  })

  test('keeps dictionary attribution and the selected part of speech when editing a meaning', async () => {
    const invoke = setup(async channel => channel === 'learning:lookupDictionary' ? { status: 'found', entries: bankEntries } : project())
    render(); await click(token('Bank'))
    await click([...document.querySelectorAll<HTMLButtonElement>('.learning-dictionary-senses button')][1]!)
    input('은행에 돈을 맡기다')
    await click(button('단어장에 담기'))
    expect(invoke).toHaveBeenCalledWith('learning:saveWord', expect.objectContaining({ meaning: '은행에 돈을 맡기다', lemma: 'bank', partOfSpeech: 'verb', dictionarySource: { ...source, modified: true } }))
  })

  test('shows a miss without AI, allows a blank save, and opens external search only after a click', async () => {
    const invoke = setup(async channel => channel === 'learning:lookupDictionary' ? emptyLookup : project())
    const open = vi.spyOn(tabs, 'createBrowserTab').mockImplementation(() => undefined)
    render(); await click(token('Cities'))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('사전에 없는 표현')
    expect(open).not.toHaveBeenCalled()
    await click(button('단어장에 담기'))
    expect(invoke).toHaveBeenCalledWith('learning:saveWord', expect.objectContaining({ meaning: '' }))
    expect(invoke.mock.calls.some(([channel]) => channel === 'learning:run')).toBe(false)
    await click(button('네이버 영어사전에서 찾기'))
    expect(open).toHaveBeenCalledWith('https://en.dict.naver.com/#/search?query=Cities')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  test('ignores an older lookup and does not close a newly selected word when a save finishes', async () => {
    const bankLookup = deferred<DictionaryLookupResult>()
    const saving = deferred<LearningProjectSnapshot>()
    const invoke = setup(async (channel, payload) => channel === 'learning:lookupDictionary'
      ? payload.text === 'Bank' ? bankLookup.promise : { status: 'found', entries: [entry('cities', 'city', '도시')] }
      : saving.promise)
    render(); await click(token('Bank')); await click(token('Cities'))
    await act(async () => { bankLookup.resolve({ status: 'found', entries: bankEntries }) })
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Cities 사전')
    expect(document.querySelector('.learning-dictionary-entries')?.textContent).toContain('도시')
    expect(document.querySelector('.learning-dictionary-entries')?.textContent).not.toContain('은행')
    act(() => button('단어장에 담기').click())
    await click(token('Bank'))
    await act(async () => { saving.resolve(project()) })
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Bank 사전')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('단어와 이 문장을 함께 담았어요')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'learning:saveWord')).toHaveLength(1)
  })

  test('does not deliver an old project save to the new project and closes portals when the pane is inactive', async () => {
    const saving = deferred<LearningProjectSnapshot>()
    setup(async channel => channel === 'learning:lookupDictionary' ? emptyLookup : saving.promise)
    const update = vi.fn()
    render(project(), update); await click(token('Bank'))
    act(() => button('단어장에 담기').click())
    const next = { ...project(), projectId: 'another-project', binding: { ...binding, rootRelPath: 'Another' } }
    render(next, update)
    await act(async () => { saving.resolve(project()) })
    expect(update).not.toHaveBeenCalled()
    await click(token('Cities'))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    render(next, update, false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  test('uses one tab stop, roves words, opens with Enter and restores keyboard focus with Escape', async () => {
    setup(async () => emptyLookup)
    render()
    expect(document.querySelectorAll('.learning-reader-word[tabindex="0"]')).toHaveLength(1)
    act(() => { token('Bank').focus(); token('Bank').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(document.activeElement).toBe(token('loans'))
    expect(document.querySelectorAll('.learning-reader-word[tabindex="0"]')).toHaveLength(1)
    await act(async () => { token('loans').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('loans 사전')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('사전 닫기')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(token('loans'))
    act(() => { token('loans').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(document.activeElement).toBe(token('adapt'))
  })

  test('selects an exact drag occurrence, keeps native selection, and does not block clicks because another selection exists', async () => {
    setup(async () => emptyLookup)
    const host = render()
    const node = token('bank')
    const range = document.createRange(); range.selectNodeContents(node)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    await act(async () => {
      node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 40, clientY: 10 }))
    })
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('bank 사전')
    expect(window.getSelection()!.toString()).toBe('bank')
    const outside = document.createElement('p'); outside.textContent = 'Other selection'; host.before(outside)
    const outsideRange = document.createRange(); outsideRange.selectNodeContents(outside)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(outsideRange)
    await act(async () => {
      token('Cities').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      token('Cities').dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
      token('Cities').click()
    })
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Cities 사전')
  })

  test('detects a duplicate location separately from another occurrence of the same word', () => {
    const first = readerWordSelection(article, 'p1', 0, 4)!
    const laterStart = text.indexOf('bank')
    const second = readerWordSelection(article, 'p1', laterStart, laterStart + 4)!
    const saved = [{ id: 'occurrence', wordId: 'bank', ...first, meaning: '은행', createdAt: 'now' }]
    expect(readerSavedOccurrence(saved, first)?.id).toBe('occurrence')
    expect(readerSavedOccurrence(saved, second)).toBeUndefined()
  })

  test('flushes the current paragraph when hidden and restores it after reflow without saving hidden scroll events', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
    const frame = (): void => { const callbacks = [...frames.values()]; frames.clear(); act(() => callbacks.forEach(callback => callback(0))) }
    const state = project()
    const invoke = setup(async () => state)
    render(state)
    const reader = document.querySelector<HTMLElement>('.learning-reader')!
    const paragraph = document.querySelector<HTMLElement>('[data-learning-paragraph="p1"]')!
    Object.defineProperties(reader, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } })
    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue({ top: 40 } as DOMRect)
    let paragraphOffset = 600
    vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => ({ top: 40 + paragraphOffset - reader.scrollTop, bottom: 200 + paragraphOffset - reader.scrollTop }) as DOMRect)
    frame()
    act(() => { reader.scrollTop = 500; reader.dispatchEvent(new Event('scroll')) })
    render(state, vi.fn(), false, false)
    await act(async () => {})
    expect(invoke).toHaveBeenCalledWith('learning:saveProgress', expect.objectContaining({ articleId: article.id, paragraphId: 'p1', scrollFraction: .2 }))
    paragraphOffset = 1400
    act(() => { reader.scrollTop = 0; reader.dispatchEvent(new Event('scroll')) })
    render(state, vi.fn(), true, true)
    frame()
    expect(reader.scrollTop).toBe(1300)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'learning:saveProgress')).toHaveLength(1)
  })
})

test('restores a paragraph across layouts, falls back to the fraction, and respects the exact top and bottom', () => {
  const reader = document.createElement('div'); const paragraph = document.createElement('p'); paragraph.dataset.learningParagraph = 'p2'; reader.append(paragraph)
  Object.defineProperties(reader, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } })
  vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue({ top: 40 } as DOMRect)
  const measure = vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ top: 620 } as DOMRect)
  restoreReaderPosition(reader, { paragraphId: 'p2', scrollFraction: .3 }); expect(reader.scrollTop).toBe(480)
  reader.scrollTop = 0; measure.mockReturnValue({ top: 820 } as DOMRect)
  restoreReaderPosition(reader, { paragraphId: 'p2', scrollFraction: .3 }); expect(reader.scrollTop).toBe(680)
  restoreReaderPosition(reader, { paragraphId: 'missing', scrollFraction: .4 }); expect(reader.scrollTop).toBe(600)
  restoreReaderPosition(reader, { paragraphId: 'p2', scrollFraction: 0 }); expect(reader.scrollTop).toBe(0)
  restoreReaderPosition(reader, { paragraphId: 'p2', scrollFraction: 1 }); expect(reader.scrollTop).toBe(1500)
})
