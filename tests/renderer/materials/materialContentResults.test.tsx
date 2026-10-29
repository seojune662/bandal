// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { useMaterialContentSearch } from '../../../src/renderer/src/features/materials/useMaterialContentSearch'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../../../src/renderer/src/features/search/openMaterialSearchHit', () => ({ openMaterialSearchHit: mocks.open }))
import { MaterialContentResults } from '../../../src/renderer/src/features/materials/MaterialContentResults'

let host: HTMLDivElement, root: Root
const empty = (): ReturnType<typeof useMaterialContentSearch> => ({ hits: [], indexing: undefined, error: undefined, pending: false, retry: vi.fn() })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.open.mockReset(); mocks.open.mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

test('indexing and query failures are not described as zero matching documents', async () => {
  const search = { ...empty(), indexing: { phase: 'indexing' as const, totalFiles: 3, processedFiles: 1, indexedPages: 12, failures: [] } }
  await act(async () => root.render(<MaterialContentResults courseId="course" query="gravity" search={search} />))
  expect(host.textContent).toContain('자료 검색 준비 중 · 1 / 3개')
  expect(host.textContent).not.toContain('일치하는 본문이 없어요')
  const failed = { ...empty(), error: '검색 연결 실패' }
  await act(async () => root.render(<MaterialContentResults courseId="course" query="gravity" search={failed} />))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('검색 연결 실패')
  expect(host.textContent).not.toContain('일치하는 본문이 없어요')
  await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
  expect(failed.retry).toHaveBeenCalledOnce()
})

test('partial indexing keeps successful matches with their page and directory', async () => {
  const hit = { kind: 'pdf' as const, relPath: 'Physics/lecture.pdf', page: 27, snippet: 'Gravity appears here', score: 1 }
  const search = { ...empty(), hits: [hit], indexing: { phase: 'partial' as const, totalFiles: 2, processedFiles: 2, indexedPages: 50, failures: [{ relPath: 'scan.pdf', reason: '텍스트 없는 PDF' }] } }
  await act(async () => root.render(<MaterialContentResults courseId="course" query="gravity" search={search} />))
  expect(host.textContent).toContain('일부 자료의 본문을 읽지 못했어요')
  expect(host.textContent).toContain('27페이지 · Physics')
  expect(host.textContent).toContain('Gravity appears here')
  await act(async () => host.querySelector<HTMLButtonElement>('.materials-content-hit')!.click())
  expect(mocks.open).toHaveBeenCalledWith('course', hit, 'gravity', false)
})
