// @vitest-environment jsdom
import React, { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WorkspaceTarget } from '../../../src/renderer/src/features/workspace/placementContext'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), sheet: vi.fn(), capture: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ openTab: mocks.open }) } }))
vi.mock('../../../src/renderer/src/features/workspace/captureWorkspaceTarget', () => ({ captureActiveWorkspaceTarget: mocks.capture }))
vi.mock('../../../src/renderer/src/features/pdfNotes/NewNoteSheet', () => ({ openNewNoteSheet: mocks.sheet }))
vi.mock('../../../src/renderer/src/features/materials/NotesGroup', () => ({ noteNodes: (tree: unknown) => tree }))
vi.mock('../../../src/renderer/src/features/pdf/drawingChanges', () => ({ notifyExternalDrawingChange: vi.fn() }))
import { useWhiteboardClipDelivery } from '../../../src/renderer/src/features/pdf/useWhiteboardClipDelivery'

const target: WorkspaceTarget = { courseId: 'placement-course', workspace: { kind: 'project', courseId: 'placement-course', rootRelPath: 'project' }, windowId: 'original', groupId: 'right' }
const source = { relPath: 'lecture.pdf', page: 2, label: 'Lecture page 2' }
const notes = [{ relPath: 'first.pdf', name: 'First' }, { relPath: 'second.pdf', name: 'Second' }]
let root: Root, api: ReturnType<typeof useWhiteboardClipDelivery>
function Harness(): JSX.Element {
  const content = useRef<HTMLDivElement>(null)
  api = useWhiteboardClipDelivery('resource-course', content)
  return <div ref={content} />
}
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.capture.mockReturnValue(target)
  mocks.invoke.mockImplementation(async (channel: string) => channel === 'materials:tree' ? notes : channel === 'pdfNotes:info' ? { orientation: 'portrait', documentRevision: 'revision' } : channel === 'drawings:listForFile' ? [] : {})
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

test('direct delivery retains its original window across slow source discovery and drawing writes', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  let pending!: Promise<void>
  act(() => { pending = api.send(source, 100, 200) })
  mocks.capture.mockReturnValue({ ...target, windowId: 'other' })
  await act(async () => { resolve([notes[0]]); await pending })
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'pdf', payload: { courseId: 'resource-course', relPath: 'first.pdf' } }, { target })
  expect(mocks.invoke).toHaveBeenCalledWith('drawings:create', expect.objectContaining({ courseId: 'resource-course', relPath: 'first.pdf', data: expect.objectContaining({ clip: source }) }))
})

test('choosing an existing note retains the target captured before the picker opened', async () => {
  await act(async () => api.send(source, 100, 200))
  expect(api.picker?.target).toEqual(target)
  mocks.capture.mockReturnValue({ ...target, windowId: 'other' })
  await act(async () => api.choose(api.picker!.boards[1]!))
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'pdf', payload: { courseId: 'resource-course', relPath: 'second.pdf' } }, { target })
})

test.each(['empty', 'picker'])('creating through the %s route retains target through the sheet callback', async route => {
  if (route === 'empty') mocks.invoke.mockResolvedValueOnce([])
  await act(async () => api.send(source, 100, 200))
  mocks.capture.mockReturnValue({ ...target, windowId: 'other' })
  if (route === 'picker') await act(async () => api.create())
  expect(mocks.sheet).toHaveBeenCalledWith('resource-course', target, expect.any(Function))
  const onCreated = mocks.sheet.mock.calls[0]![2] as (path: string) => Promise<void>
  await act(async () => onCreated('new.pdf'))
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'pdf', payload: { courseId: 'resource-course', relPath: 'new.pdf' } }, { target })
})
