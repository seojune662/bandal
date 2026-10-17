// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ migrate: vi.fn(), loadTree: vi.fn(), toast: vi.fn() }))
vi.mock('../../../src/renderer/src/features/pdfNotes/legacyMigration', () => ({ migrateCourseNotes: mocks.migrate }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: mocks.loadTree }) } }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
import { useLegacyNoteMigration } from '../../../src/renderer/src/features/materials/NotesGroup'

function Probe({ courseId }: { courseId: string }): null { useLegacyNoteMigration(courseId); return null }
let root: Root, container: HTMLDivElement
const idle = { migrated: [], failed: [] }
const render = async (courseId: string) => { await act(async () => root.render(<Probe courseId={courseId} />)) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.loadTree.mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

test('a prior course migration cannot refresh the tree or warn after switching courses', async () => {
  let finish!: (value: unknown) => void
  mocks.migrate.mockImplementation(id => id === 'A' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(idle))
  await render('A'); await render('B')
  await act(async () => finish({ migrated: [{}], failed: [{ message: 'A delayed error' }] }))
  expect(mocks.loadTree).not.toHaveBeenCalled()
  expect(mocks.toast).not.toHaveBeenCalled()
})

test('a migrated note refreshes only its own course tree and failures surface once', async () => {
  mocks.migrate.mockResolvedValue({ migrated: [{}], failed: [{ message: '한 개 실패' }] })
  await render('B')
  expect(mocks.loadTree).toHaveBeenCalledWith('B', { refreshOnly: true })
  expect(mocks.toast).toHaveBeenCalledWith('한 개 실패', 'danger')
  expect(mocks.migrate).toHaveBeenCalledTimes(1)
})
