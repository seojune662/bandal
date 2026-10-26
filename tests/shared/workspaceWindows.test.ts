import { expect, test } from 'vitest'
import { workspaceFromKey, workspaceKey } from '../../src/shared/types/workspace'
import { readWorkspaceWindows, workspaceWindowFromKey, workspaceWindowKey, type WorkspaceWindows } from '../../src/shared/workspaceWindows'
import { rewriteWorkspaceLayoutPaths } from '../../src/shared/workspaceLayoutPaths'

test('canvas keys preserve workspace ownership and never change the default legacy key', () => {
  const workspace = { kind: 'project' as const, courseId: 'owner', rootRelPath: 'a/한글' }, base = workspaceKey(workspace)
  expect(workspaceWindowKey(base, 'main')).toBe(base)
  const key = workspaceWindowKey(base, 'second')
  expect(workspaceWindowFromKey(key)).toEqual({ workspaceKey: base, windowId: 'second' })
  expect(workspaceFromKey(key)).toEqual(workspace)
})

test('a single legacy layout remains untouched inside the first window', () => {
  const legacy = { grid: { root: {} }, panels: {} }
  const collection = readWorkspaceWindows(legacy)
  expect(collection.activeWindowId).toBe('main')
  expect(collection.windows[0]).toMatchObject({ id: 'main', chromeMode: 'all', layout: legacy })
  expect(collection.windows[0]!.layout).toBe(legacy)
})

test('invalid window collections fail without dropping saved windows', () => {
  const window = { id: 'main', name: 'First', chromeMode: 'all', layout: {} }
  expect(() => readWorkspaceWindows({ kind: 'workspace-windows', version: 1, windows: [window, window] })).toThrow()
  expect(() => readWorkspaceWindows({ kind: 'workspace-windows', version: 2, windows: [window] })).toThrow()
  expect(() => readWorkspaceWindows({ kind: 'workspace-windows', version: 1, windows: [] })).toThrow()
})

test('path rewriting reaches all windows and preserves each view identity and metadata', () => {
  const layout = (suffix: string) => {
    const id = `note:owner:old/a.md::duplicate::${suffix}`
    return { panels: { [id]: { id, params: { descriptor: { kind: 'note', payload: { courseId: 'owner', relPath: 'old/a.md' } } } } },
      grid: { root: { type: 'leaf', data: { id: 'g', views: [id], activeView: id } } } }
  }
  const collection: WorkspaceWindows = { kind: 'workspace-windows', version: 1, activeWindowId: 'second', windows: [
    { id: 'main', name: 'First', chromeMode: 'tabs-hidden', layout: layout('first') },
    { id: 'second', name: 'Second', chromeMode: 'all-hidden', layout: layout('second') }
  ] }
  const rewritten = rewriteWorkspaceLayoutPaths(collection, { courseId: 'owner', fromRelPath: 'old', toRelPath: 'new', isDirectory: true })
  expect(rewritten.changed).toBe(true)
  const next = readWorkspaceWindows(rewritten.layout)
  expect(next.activeWindowId).toBe('second')
  expect(next.windows.map(window => window.chromeMode)).toEqual(['tabs-hidden', 'all-hidden'])
  for (const [index, window] of next.windows.entries()) {
    const value = window.layout as ReturnType<typeof layout>, id = `note:owner:new/a.md::duplicate::${index ? 'second' : 'first'}`
    expect(Object.keys(value.panels)).toEqual([id])
    expect(value.grid.root.data).toMatchObject({ views: [id], activeView: id })
  }
  expect(JSON.stringify(collection)).toContain('old/a.md')
})
