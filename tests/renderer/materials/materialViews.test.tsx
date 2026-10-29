// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MaterialBrowser, MaterialViewMenu } from '../../../src/renderer/src/features/materials/MaterialViews'
import { MATERIAL_VIEW_STORAGE_KEY, readMaterialView, rememberMaterialView, type MaterialView } from '../../../src/renderer/src/features/materials/materialViewPreference'
import type { MaterialTreeProps } from '../../../src/renderer/src/features/materials/MaterialTree'

const openMaterial = vi.hoisted(() => vi.fn())
const nativeDrag = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/features/workspace/openMaterial', () => ({ openMaterialInWorkspace: openMaterial }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), startMaterialDrag: nativeDrag }))
vi.mock('../../../src/renderer/src/features/materials/MaterialAffordances', () => ({ MaterialRowAffordance: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../../src/renderer/src/features/materials/preview/MaterialPreviewContent', () => ({ MaterialPreviewContent: ({ node }: { node: { name: string } }) => <div>Preview: {node.name}</div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
let props: MaterialTreeProps
const nodes: MaterialTreeProps['nodes'] = [
  { name: 'Week 1', relPath: 'Week 1', kind: 'dir', children: [{ name: 'lesson.pdf', relPath: 'Week 1/lesson.pdf', kind: 'pdf', size: 2048 }] },
  { name: 'memo.md', relPath: 'memo.md', kind: 'note', mtime: 1_700_000_000_000, size: 128 },
  { name: 'image.png', relPath: 'image.png', kind: 'image' }
]

beforeEach(() => {
  localStorage.clear(); openMaterial.mockClear(); nativeDrag.mockClear()
  host = document.createElement('div'); host.className = 'materials-body'; document.body.append(host); root = createRoot(host)
  props = { courseId: 'course', nodes, expandedPaths: {}, editingRelPath: null, selectedRelPath: null, pasteTargetDirRelPath: null, dropTargetDirRelPath: null, urlDropTargetDirRelPath: null, downloadingDirRelPath: null,
    onToggleFolder: vi.fn(), onSelect: vi.fn(), onContextMenu: vi.fn(), onCancelRename: vi.fn(), onRename: vi.fn(async () => null), onDropTargetChange: vi.fn(), onUrlDropTargetChange: vi.fn(), onMove: vi.fn(), onImportFiles: vi.fn(), onDownloadUrl: vi.fn(), onUnsupportedDrop: vi.fn() }
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const click = (element: Element): void => { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
const row = (path: string): HTMLButtonElement => host.querySelector(`[data-material-path="${path}"]`)!

function Browser({ view }: { view: MaterialView }): JSX.Element {
  const [directory, setDirectory] = useState('')
  const [selectedRelPath, select] = useState<string | null>(null)
  return <MaterialBrowser {...props} view={view} directory={directory} onDirectoryChange={setDirectory} selectedRelPath={selectedRelPath} onSelect={node => { props.onSelect(node); select(node.relPath) }} />
}
async function render(view: MaterialView): Promise<void> { await act(async () => { root.render(<Browser view={view} />) }) }

test('view menu keeps a checked choice, supports keyboard navigation, and persists the chosen view', async () => {
  function Picker(): JSX.Element {
    const [view, setView] = useState(readMaterialView)
    return <MaterialViewMenu value={view} onChange={next => { setView(next); rememberMaterialView(next) }} />
  }
  act(() => root.render(<Picker />))
  const trigger = host.querySelector('[aria-label="자료 보기 방식"]')!
  click(trigger)
  expect(host.querySelector('[aria-checked="true"]')?.textContent).toContain('목록')
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement?.textContent).toBe('열')
  click(document.activeElement!)
  expect(localStorage.getItem(MATERIAL_VIEW_STORAGE_KEY)).toBe('columns')
  expect(host.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(readMaterialView()).toBe('columns')
  localStorage.setItem(MATERIAL_VIEW_STORAGE_KEY, 'unknown-view')
  expect(readMaterialView()).toBe('list')
})

test('icon cards preview actual contents, drill into folders, and retain opening and context actions', async () => {
  await render('icons')
  expect(host.querySelectorAll('.material-card-preview')).toHaveLength(3)
  expect(row('memo.md').textContent).toContain('Preview: memo.md')
  click(row('memo.md'))
  expect(openMaterial).toHaveBeenCalledWith('note', 'memo.md', undefined)
  act(() => row('memo.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), nodes[1])
  await act(async () => click(row('Week 1')))
  expect(row('Week 1/lesson.pdf')).not.toBeNull()
  expect(row('memo.md')).toBeNull()
  expect(host.querySelector('[aria-current="location"]')?.textContent).toBe('Week 1')
  await act(async () => click(host.querySelector('[aria-label="전체 자료"]')!))
  expect(row('memo.md')).not.toBeNull()
})

test('gallery selection updates a large preview without opening, while Enter and the open button do open', async () => {
  await render('gallery')
  click(row('image.png'))
  expect(host.querySelector('.materials-gallery-preview')?.textContent).toContain('image.png')
  expect(openMaterial).not.toHaveBeenCalled()
  act(() => row('image.png').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(openMaterial).toHaveBeenLastCalledWith('image', 'image.png', undefined)
  click(host.querySelector('.materials-preview-open')!)
  expect(openMaterial).toHaveBeenCalledTimes(2)
})

test('columns retain the parent column and append folder contents, then show the selected file preview', async () => {
  await render('columns')
  click(row('Week 1'))
  expect(host.querySelectorAll('.materials-column')).toHaveLength(2)
  expect(row('memo.md')).not.toBeNull()
  expect(row('Week 1/lesson.pdf')).not.toBeNull()
  await act(async () => click(row('Week 1/lesson.pdf')))
  expect(host.querySelector('.materials-column-preview')?.textContent).toContain('lesson.pdf')
  expect(openMaterial).not.toHaveBeenCalled()
  await act(async () => click(row('memo.md')))
  expect(host.querySelectorAll('.materials-column')).toHaveLength(1)
  expect(host.querySelector('.materials-column-preview')?.textContent).toContain('memo.md')
})

test('icon cards use native file drag and folder drops still target the exact directory', async () => {
  await render('icons')
  const drag = new Event('dragstart', { bubbles: true, cancelable: true })
  act(() => row('memo.md').dispatchEvent(drag))
  expect(nativeDrag).toHaveBeenCalledWith('course', 'memo.md')
  expect(drag.defaultPrevented).toBe(true)
  const file = new File(['image'], 'photo.png', { type: 'image/png' })
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file], getData: () => '' } })
  act(() => row('Week 1').dispatchEvent(drop))
  expect(props.onImportFiles).toHaveBeenCalledWith([file], 'Week 1')
})

test('search result icon and gallery views retain nested paths without hiding results behind folders', async () => {
  await act(async () => root.render(<MaterialBrowser {...props} nodes={[nodes[0]!.children![0]!]} view="icons" directory="Week 1" onDirectoryChange={vi.fn()} searching />))
  expect(row('Week 1/lesson.pdf')).not.toBeNull()
  expect(host.querySelector('.materials-breadcrumbs')).toBeNull()
})

test('inline rename remains usable in icon view', async () => {
  props.editingRelPath = 'memo.md'
  await render('icons')
  const input = host.querySelector<HTMLInputElement>('[aria-label="memo.md 이름 변경"]')!
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(4)
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(props.onCancelRename).toHaveBeenCalledOnce()
})

test('readable list shows thumbnails and metadata, enters folders and returns without a tree', async () => {
  await render('list')
  expect(row('memo.md').querySelector('.material-card-preview')).not.toBeNull()
  expect(row('memo.md').querySelector('.material-row__details')?.textContent).toContain('마크다운')
  await act(async () => click(row('Week 1')))
  expect(row('Week 1/lesson.pdf')).not.toBeNull()
  expect(row('memo.md')).toBeNull()
  await act(async () => click(host.querySelector('[aria-label="상위 폴더로"]')!))
  expect(row('memo.md')).not.toBeNull()
  expect(host.querySelector('.material-tree')).toBeNull()
})

test('compact retains expandable inline tree and scoped list cannot escape its project root', async () => {
  await render('compact')
  click(row('Week 1'))
  expect(props.onToggleFolder).toHaveBeenCalledWith('Week 1')
  expect(row('memo.md')).not.toBeNull()
  await act(async () => root.render(<MaterialBrowser {...props} nodes={[{ kind: 'dir', name: 'Empty', relPath: 'projects/a/Empty', children: [] }]} view="list" rootRelPath="projects/a" directory="projects/a/Empty" onDirectoryChange={props.onToggleFolder} />))
  click(host.querySelector('[aria-label="상위 폴더로"]')!)
  expect(props.onToggleFolder).toHaveBeenLastCalledWith('projects/a')
  expect(host.textContent).toContain('이 폴더에 자료를 드래그')
})

test('a large readable list mounts a bounded set of previews and keyboard End reaches its last row', async () => {
  props.nodes = Array.from({ length: 1200 }, (_, index) => ({ name: `file-${index}.md`, relPath: `file-${index}.md`, kind: 'note' }))
  await render('list')
  expect(host.querySelector('[data-total-rows]')?.getAttribute('data-total-rows')).toBe('1200')
  expect(host.querySelectorAll('[data-material-row]')).toHaveLength(30)
  await act(async () => {
    row('file-0.md').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement?.getAttribute('data-material-path')).toBe('file-1199.md')
})
