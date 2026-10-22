// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { exportMaterialFile, MaterialExportButton } from '../../../src/renderer/src/features/materials/MaterialExportButton'
import { invoke } from '../../../src/renderer/src/lib/ipc'
import { flushOpenNoteSession } from '../../../src/renderer/src/features/notes/noteSessionRegistry'
import { showToast } from '../../../src/renderer/src/app/toast'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ flushOpenNoteSession: vi.fn() }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

test('waits for the latest Markdown to save and uses the resulting renamed path', async () => {
  let finish!: (value: Awaited<ReturnType<typeof flushOpenNoteSession>>) => void
  vi.mocked(flushOpenNoteSession).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(invoke).mockResolvedValue({ savedPath: '/share/note.md' })
  const pending = exportMaterialFile({ courseId: 'course', relPath: 'old.md' })
  expect(invoke).not.toHaveBeenCalled()
  finish({ result: { status: 'saved' }, ref: { courseId: 'course', relPath: 'renamed.md' } })
  await pending
  expect(invoke).toHaveBeenCalledWith('materials:export', { courseId: 'course', relPath: 'renamed.md' })
})

test.each(['conflict', 'error', 'unavailable'] as const)('refuses stale Markdown when saving reports %s', async status => {
  vi.mocked(flushOpenNoteSession).mockResolvedValue({ result: status === 'unavailable' ? { status } : { status, detail: 'failure' }, ref: { courseId: 'course', relPath: 'note.md' } })
  await expect(exportMaterialFile({ courseId: 'course', relPath: 'note.md' })).rejects.toThrow('저장하지 못했어요')
  expect(invoke).not.toHaveBeenCalled()
})

test('exports binary originals without involving note sessions', async () => {
  vi.mocked(invoke).mockResolvedValue({ savedPath: '/share/image.png' })
  await exportMaterialFile({ courseId: 'course', relPath: 'image.png' })
  expect(flushOpenNoteSession).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('materials:export', { courseId: 'course', relPath: 'image.png' })
})

test('commits a focused editor before exporting and suppresses concurrent requests', async () => {
  const editor = document.createElement('input'); host.append(editor)
  const order: string[] = []
  editor.addEventListener('blur', () => order.push('commit'))
  let finish!: () => void
  const onExport = vi.fn(async () => {
    order.push('export')
    await new Promise<void>(resolve => { finish = resolve })
    return { savedPath: null }
  })
  act(() => root.render(<MaterialExportButton onExport={onExport} />))
  // Append outside React's render target so it remains present while mounted.
  document.body.append(editor); editor.focus()
  const button = host.querySelector('button')!
  await act(async () => { button.click(); button.click() })
  expect(order).toEqual(['commit', 'export'])
  expect(onExport).toHaveBeenCalledOnce()
  expect(button.disabled).toBe(true)
  await act(async () => { finish() })
  expect(button.disabled).toBe(false)
  expect(showToast).not.toHaveBeenCalled()
  editor.remove()
})
