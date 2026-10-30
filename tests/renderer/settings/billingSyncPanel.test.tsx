// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { BillingSyncPanel } from '../../../src/renderer/src/features/settings/BillingSyncPanel'

const conflicts = [
  { id: 'conflict', label: '물리학 · 수업.md', reason: '두 기기에서 수정했습니다.', local: false, remote: true,
    variants: { local: { exists: false, deleted: false }, remote: { exists: true, deleted: false, text: '운동량은 보존됩니다.', updatedAt: '2026-10-17T00:00:00.000Z' } } },
  { id: 'pending-ink:one', kind: 'pending-ink', label: '노트/실험.pdf', reason: '이전 페이지 필기를 보관했습니다.' }
]

async function render(sync: Record<string, unknown>, items: unknown[] = conflicts): Promise<{ element: HTMLDivElement; unmount(): Promise<void> }> {
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation(async channel => {
    if (channel === 'billing:getState') throw new Error('offline')
    if (channel === 'runtime:syncState') return { enabled: false, pending: 0, conflicts: items.length, ...sync }
    if (channel === 'runtime:syncConflicts') return items
    throw new Error('unexpected channel')
  })
  const element = document.createElement('div'), root = createRoot(element)
  await act(async () => root.render(<BillingSyncPanel />))
  return { element, unmount: () => act(() => root.unmount()) }
}
const button = (element: HTMLElement, text: string) => [...element.querySelectorAll('button')].find(item => item.textContent === text)

test('with account sync retired, preserved copies stay recoverable and nothing asks the server', async () => {
  const { element, unmount } = await render({ available: false })
  try {
    expect(element.textContent).toContain('필기 복구')
    expect(element.textContent).toContain('물리학 · 수업.md')
    expect(element.textContent).toContain('운동량은 보존됩니다.')
    expect(element.textContent).toContain('노트/실험.pdf')
    expect(button(element, '이 기기 사본 사용')!.disabled).toBe(true)
    expect(button(element, '다른 기기 사본 사용')!.disabled).toBe(false)
    expect(button(element, '이전 필기로 복구 노트 만들기')!.disabled).toBe(false)
    expect(button(element, '현재 페이지 유지')!.disabled).toBe(false)
    expect(button(element, '지금 동기화')).toBeUndefined()
    expect(element.textContent).not.toContain('반달 구독')
    expect(ipc.invoke.mock.calls.map(([channel]) => channel)).not.toContain('billing:getState')
  } finally { await unmount() }
})

test('with account sync retired and nothing to recover, the panel renders nothing', async () => {
  const { element, unmount } = await render({ available: false }, [])
  try { expect(element.innerHTML).toBe('') } finally { await unmount() }
})

test('the legacy flag still shows the full panel for support', async () => {
  const { element, unmount } = await render({ available: true })
  try {
    expect(element.textContent).toContain('반달 구독')
    expect(element.textContent).toContain('노트/실험.pdf')
    expect(button(element, '지금 동기화')!.disabled).toBe(true)
  } finally { await unmount() }
})
