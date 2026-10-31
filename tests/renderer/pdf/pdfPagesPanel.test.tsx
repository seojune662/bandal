// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { failureText, PdfPagesPanel } from '../../../src/renderer/src/features/pdf/PdfPagesPanel'

const invoke = vi.fn()
beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ documentRevision: 'next', fingerprint: 'f', pageCount: 3, pageMap: [[1], [2]] })
  Object.assign(window, { bandal: { invoke } })
  // jsdom has no IntersectionObserver or scrollIntoView; thumbnails and scrolling are not under test.
  Object.assign(globalThis, { IntersectionObserver: class { observe(): void {} disconnect(): void {} } })
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => vi.restoreAllMocks())

async function render(appendOnly: boolean) {
  const element = document.body.appendChild(document.createElement('div')), root = createRoot(element)
  await act(async () => root.render(<PdfPagesPanel pdf={null} numPages={2} currentPage={1} onJump={() => {}} courseId="c1" relPath="노트.pdf"
    revision="rev" appendOnly={appendOnly} suspend={async () => {}} resume={() => {}} onRestructured={() => {}} />))
  return { element, unmount: async () => { await act(() => root.unmount()); element.remove() } }
}

test('a synced document offers only appending pages at the end', async () => {
  const { element, unmount } = await render(true)
  try {
    expect(element.textContent).toContain('끝에 페이지를 덧붙이는 것만 할 수 있어요')
    expect(element.querySelector('.pdf-pages__more')).toBeNull()
    await act(async () => [...element.querySelectorAll('button')].find(item => item.textContent === '+ 페이지 추가')!.click())
    expect(invoke).toHaveBeenCalledWith('pdf:restructure', expect.objectContaining({ courseId: 'c1', relPath: '노트.pdf', expectedRevision: 'rev' }))
    const pages = (invoke.mock.calls[0]![1] as { pages: { source: number | null }[] }).pages.map(page => page.source)
    expect(pages).toEqual([1, 2, null])
  } finally {
    await unmount()
  }
})

test('an unsynced document keeps every page menu', async () => {
  const { element, unmount } = await render(false)
  try {
    expect(element.querySelectorAll('.pdf-pages__more')).toHaveLength(2)
    expect(element.textContent).not.toContain('끝에 페이지를 덧붙이는 것만')
  } finally {
    await unmount()
  }
})

test('a refusal from the main process reads without Electron\'s prefix', () => {
  expect(failureText(new Error("Error invoking remote method 'pdf:restructure': ValidationError: 동기화 중인 문서는 끝에 페이지를 덧붙이는 것만 할 수 있어요.")))
    .toBe('동기화 중인 문서는 끝에 페이지를 덧붙이는 것만 할 수 있어요.')
})
