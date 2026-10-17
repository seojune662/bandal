// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ migrate: vi.fn(), invoke: vi.fn(), loadTree: vi.fn(), openTab: vi.fn() }))
vi.mock('../../../src/renderer/src/features/pdfNotes/legacyMigration', () => ({ migrateCourseNotes: mocks.migrate }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: mocks.loadTree }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ openTab: mocks.openTab }) } }))
vi.mock('../../../src/renderer/src/features/pdfNotes/NewNoteSheet', () => ({ openNewNoteSheet: vi.fn() }))
import { NotesGroup } from '../../../src/renderer/src/features/materials/NotesGroup'

let root: Root, container: HTMLDivElement
const board = (id: string, courseId: string) => ({ id, courseId, title: `${courseId} original`, background: 'lines', surface: 'light', pageCount: 1, sortOrder: 0, createdAt: '', updatedAt: '' })
const result = { migrated: [], failed: [] }
const render = async (courseId: string) => { await act(async () => root.render(<NotesGroup courseId={courseId} nodes={[]}>{() => null}</NotesGroup>)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.loadTree.mockResolvedValue(undefined)
  mocks.invoke.mockImplementation(async (channel, request) => channel === 'canvas:list' ? [board(`${request.courseId}-board`,request.courseId)] : [])
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount());container.remove() })

test('a prior course migration cannot publish its error or original IDs after switching courses', async () => {
  let finish!: (value: unknown) => void
  mocks.migrate.mockImplementation(id => id === 'A' ? new Promise(resolve => { finish=resolve }) : Promise.resolve(result))
  await render('A');await render('B')
  await act(async () => finish({migrated:[{}],failed:[{message:'A delayed error'}]}))
  expect(container.textContent).toContain('B original')
  expect(container.textContent).not.toContain('A original')
  expect(container.textContent).not.toContain('A delayed error')
  expect(mocks.invoke.mock.calls.some(([,request])=>request.courseId==='A')).toBe(false)
  expect(mocks.loadTree).not.toHaveBeenCalled()
  await act(async () => [...container.querySelectorAll('button')].find(button=>button.textContent==='B original 원본 열기')!.click())
  expect(mocks.openTab).toHaveBeenCalledWith(expect.objectContaining({payload:{courseId:'B',boardId:'B-board'}}))
})

test('original list completion is ignored after a course changes even when migration already finished', async () => {
  let finish!: (value: unknown) => void
  mocks.migrate.mockResolvedValue(result)
  mocks.invoke.mockImplementation(async (channel, request) => channel==='canvas:list' && request.courseId==='A'
    ? new Promise(resolve=>{finish=resolve}) : channel==='canvas:list' ? [board('B-board','B')] : [])
  await render('A');await render('B')
  await act(async () => finish([board('A-board','A')]))
  expect(container.textContent).toContain('B original')
  expect(container.textContent).not.toContain('A original')
})
