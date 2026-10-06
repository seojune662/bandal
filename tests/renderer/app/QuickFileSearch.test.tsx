// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QuickFileSearch } from '../../../src/renderer/src/app/QuickFileSearch'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), close: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/features/workspace/openMaterial', () => ({ openMaterialInCourse: mocks.open }))
vi.mock('../../../src/renderer/src/features/browser/webviewPassthrough', () => ({ acquirePointerPassthrough: () => () => {} }))
vi.mock('../../../src/renderer/src/app/shortcuts', () => ({ useQuickSearch: (select: (state: unknown) => unknown) => select({ isOpen: true, close: mocks.close }) }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => {
  const state = { courses: [{ id: 'course', name: '물리학' }], selectedCourseId: 'course' }
  return { useCoursesStore: (select: (state: unknown) => unknown) => select(state) }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<QuickFileSearch />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
async function query(value: string) {
  await act(async () => Simulate.change(host.querySelector('input')!, { target: { value } } as never))
}

test('changing the query cannot open a result from the previous query during debounce', async () => {
  mocks.invoke.mockResolvedValue([{ name: 'first.md', relPath: 'first.md', kind: 'note', score: 1 }])
  await query('first'); await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(host.textContent).toContain('first.md')
  await query('second')
  await act(async () => Simulate.keyDown(host.querySelector('input')!, { key: 'Enter' }))
  expect(mocks.open).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('first.md')
})

test('search failure offers a retry without being presented as zero results', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('검색 서버에 연결하지 못했어요.'))
    .mockResolvedValue([{ name: 'recovered.md', relPath: 'recovered.md', kind: 'note', score: 1 }])
  await query('recover'); await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('검색 서버에 연결하지 못했어요.')
  expect(host.textContent).not.toContain('결과 없음')
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '다시 시도')!
  expect(retry).toBeDefined()
  await act(async () => retry.click())
  await act(async () => vi.advanceTimersByTimeAsync(180))
  expect(host.textContent).toContain('recovered.md')
})
