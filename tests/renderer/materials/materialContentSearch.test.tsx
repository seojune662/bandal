// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SearchHit } from '../../../src/shared/types/search'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: { courseId: string }) => void>() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke,
  onPush: (channel: string, listener: (event: { courseId: string }) => void) => { mocks.listeners.set(channel, listener); return () => mocks.listeners.delete(channel) }
}))
import { useMaterialContentSearch } from '../../../src/renderer/src/features/materials/useMaterialContentSearch'

let container: HTMLDivElement, root: Root
let result: ReturnType<typeof useMaterialContentSearch>
function Harness({ courseId = 'course', query = '중력', folder = '' }: { courseId?: string | null; query?: string; folder?: string }) {
  result = useMaterialContentSearch(courseId, query, folder)
  return <div>{result.hits.map(hit => hit.snippet).join(',')}</div>
}
const hit = (relPath: string, snippet: string): SearchHit => ({ relPath, snippet, kind: 'pdf', page: 3, score: 1 })
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); mocks.invoke.mockReset(); mocks.listeners.clear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers() })

test('query and folder changes hide old results immediately and ignore a late previous response', async () => {
  let first!: (value: { hits: SearchHit[] }) => void
  mocks.invoke.mockImplementation((_channel, request) => request.rootRelPath === 'old'
    ? new Promise(resolve => { first = resolve })
    : Promise.resolve({ hits: [hit('new/lecture.pdf', '현재 폴더 내용')] }))
  await act(async () => root.render(<Harness folder="old" />)); await tick(240)
  expect(result.pending).toBe(true)
  await act(async () => root.render(<Harness folder="new" />))
  expect(result.hits).toEqual([]); expect(result.pending).toBe(true)
  await tick(240)
  expect(mocks.invoke).toHaveBeenLastCalledWith('search:query', { courseId: 'course', query: '중력', rootRelPath: 'new', limit: 100 })
  await act(async () => first({ hits: [hit('old/lecture.pdf', '옛 폴더 내용')] }))
  expect(container.textContent).toBe('현재 폴더 내용')
  await act(async () => root.render(<Harness query="에너지" folder="new" />))
  expect(result.hits).toEqual([]); expect(result.pending).toBe(true)
})

test('course switch and empty queries cancel scheduled requests and subscriptions', async () => {
  mocks.invoke.mockResolvedValue({ hits: [] })
  await act(async () => root.render(<Harness />)); await tick(100)
  await act(async () => root.render(<Harness courseId="other" />)); await tick(240)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
  expect(mocks.invoke.mock.calls[0]?.[1].courseId).toBe('other')
  await act(async () => root.render(<Harness courseId={null} query="" />)); await tick(300)
  expect(result.pending).toBe(false); expect(result.hits).toEqual([])
  expect(mocks.listeners.size).toBe(0)
})

test('index and filesystem pushes refresh the active query without progress bursts starving it', async () => {
  mocks.invoke.mockResolvedValue({ hits: [hit('lecture.pdf', '검색됨')] })
  await act(async () => root.render(<Harness />)); await tick(240)
  await act(async () => mocks.listeners.get('search:changed')?.({ courseId: 'unrelated' })); await tick(200)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
  for (let index = 0; index < 8; index++) {
    await act(async () => mocks.listeners.get('search:changed')?.({ courseId: 'course' }))
    await tick(50); await tick(1)
  }
  expect(mocks.invoke.mock.calls.length).toBeGreaterThan(2)
  const previous = mocks.invoke.mock.calls.length
  await act(async () => mocks.listeners.get('materials:changed')?.({ courseId: 'course' })); await tick(101); await tick(1)
  expect(mocks.invoke.mock.calls.length).toBeGreaterThan(previous)
  expect(result.pending).toBe(false)
})

test('failed search can retry and keeps the backend partial-index status', async () => {
  const indexing = { phase: 'partial', totalFiles: 2, processedFiles: 2, indexedPages: 20, failures: [{ relPath: 'scan.pdf', reason: '텍스트가 없는 PDF' }] }
  mocks.invoke.mockRejectedValueOnce(new Error('검색 실패')).mockResolvedValueOnce({ hits: [hit('lecture.pdf', '복구됨')], indexing })
  await act(async () => root.render(<Harness />)); await tick(240)
  expect(result.error).toBe('검색 실패'); expect(result.pending).toBe(false)
  await act(async () => result.retry()); await tick(1)
  expect(result.error).toBeUndefined(); expect(result.indexing).toEqual(indexing)
  expect(container.textContent).toBe('복구됨')
})
