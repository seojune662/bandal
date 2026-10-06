import { beforeEach, expect, test, vi } from 'vitest'
import type { MaterialNode } from '../../../src/shared/types/materials'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: { getState: () => ({ courses: [] }) }
}))
let useMaterialsStore: typeof import('../../../src/renderer/src/stores/materialsStore').useMaterialsStore
const tree: MaterialNode[] = [{ name: 'notes', relPath: 'notes', kind: 'dir', children: [] }]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(async () => {
  vi.resetModules()
  invoke.mockReset()
  invoke.mockImplementation(async channel => channel === 'materials:snapshot' ? { tree: null } : tree)
  ;({ useMaterialsStore } = await import('../../../src/renderer/src/stores/materialsStore'))
})

test('returning to a cached course clears the previous course loading skeleton immediately', async () => {
  await useMaterialsStore.getState().loadTree('cached')
  const slow = deferred<{ tree: null }>(), refresh = deferred<MaterialNode[]>()
  invoke.mockImplementation((channel, { courseId }) => courseId === 'slow' ? slow.promise : refresh.promise)
  const loading = useMaterialsStore.getState().loadTree('slow')
  expect(useMaterialsStore.getState().isLoading).toBe(true)
  const returning = useMaterialsStore.getState().loadTree('cached')
  expect(useMaterialsStore.getState().tree).toEqual(tree)
  expect(useMaterialsStore.getState().isLoading).toBe(false)
  slow.resolve({ tree: null }); refresh.resolve(tree)
  await Promise.all([loading, returning])
})

test('clearing the active course preserves its expanded tree for the next visit', async () => {
  await useMaterialsStore.getState().loadTree('cached')
  useMaterialsStore.getState().toggleFolder('notes')
  useMaterialsStore.getState().clear()
  const refresh = deferred<MaterialNode[]>()
  invoke.mockReturnValue(refresh.promise)
  const returning = useMaterialsStore.getState().loadTree('cached')
  expect(useMaterialsStore.getState().expandedPaths.notes).toBe(true)
  expect(useMaterialsStore.getState().tree).toEqual(tree)
  refresh.resolve(tree)
  await returning
})

test('a failed optional disk snapshot still loads the live material tree', async () => {
  invoke.mockImplementation(async channel => {
    if (channel === 'materials:snapshot') throw new Error('Snapshot unavailable')
    return tree
  })
  await useMaterialsStore.getState().loadTree('uncached')
  expect(useMaterialsStore.getState().tree).toEqual(tree)
  expect(useMaterialsStore.getState().error).toBeNull()
  expect(useMaterialsStore.getState().isLoading).toBe(false)
})

test('a delayed search from a hidden course cannot leave the current course searching', async () => {
  await useMaterialsStore.getState().loadTree('current')
  await useMaterialsStore.getState().search('old', 'notes')
  expect(useMaterialsStore.getState().isSearching).toBe(false)
  expect(invoke).not.toHaveBeenCalledWith('materials:search', expect.anything())
})

test('a background mutation refresh does not replace the selected course or cancel its active scan', async () => {
  await useMaterialsStore.getState().loadTree('old')
  const response = deferred<MaterialNode[]>()
  invoke.mockImplementation(async channel => channel === 'materials:snapshot' ? { tree: null } : response.promise)
  const pending = useMaterialsStore.getState().loadTree('current')
  await Promise.resolve()
  await useMaterialsStore.getState().loadTree('old', { refreshOnly: true, silent: true })
  expect(useMaterialsStore.getState().activeCourseId).toBe('current')
  const currentTree: MaterialNode[] = [{ name: 'current.md', relPath: 'current.md', kind: 'note' }]
  response.resolve(currentTree)
  await pending
  expect(useMaterialsStore.getState().tree).toEqual(currentTree)
  expect(useMaterialsStore.getState().isLoading).toBe(false)
})
