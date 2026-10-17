// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { BillingSyncPanel } from '../../../src/renderer/src/features/settings/BillingSyncPanel'

test('offline recovery identifies each document and distinguishes unavailable versions', async () => {
  const conflicts = [
    { id: 'conflict', label: '물리학 · 수업.md', reason: '두 기기에서 수정했습니다.', local: false, remote: true,
      variants: { local: { exists: false, deleted: false }, remote: { exists: true, deleted: false, text: '운동량은 보존됩니다.', updatedAt: '2026-10-17T00:00:00.000Z' } } },
    { id: 'pending-ink:one', kind: 'pending-ink', label: '노트/실험.pdf', reason: '이전 페이지 필기를 보관했습니다.' }
  ]
  ipc.invoke.mockImplementation(async channel => {
    if (channel === 'billing:getState') throw new Error('offline')
    if (channel === 'runtime:syncState') return { enabled: false, pending: 0, conflicts: conflicts.length }
    if (channel === 'runtime:syncConflicts') return conflicts
    throw new Error('unexpected channel')
  })
  const element = document.createElement('div'), root = createRoot(element)
  try {
    await act(async () => root.render(<BillingSyncPanel />))
    expect(element.textContent).toContain('물리학 · 수업.md')
    expect(element.textContent).toContain('운동량은 보존됩니다.')
    expect(element.textContent).toContain('노트/실험.pdf')
    const button = (text: string) => [...element.querySelectorAll('button')].find(item => item.textContent === text)!
    expect(button('이 기기 사본 사용').disabled).toBe(true)
    expect(button('다른 기기 사본 사용').disabled).toBe(false)
    expect(button('이전 필기로 복구 노트 만들기').disabled).toBe(false)
    expect(button('현재 페이지 유지').disabled).toBe(false)
    expect(button('지금 동기화').disabled).toBe(true)
  } finally { await act(() => root.unmount()) }
})
