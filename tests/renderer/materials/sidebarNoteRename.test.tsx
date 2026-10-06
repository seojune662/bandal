// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'
import type { NoteRef } from '../../../src/shared/types/note'
import type { NoteRenameResponse } from '../../../src/renderer/src/features/notes/noteRenameSync'

// Keep the real NoteSession state, registry and save logic. Only replace the
// Milkdown surface so edits and canonical reseeds can be observed in jsdom.
const milkdown = vi.hoisted(() => ({ entry: null as any }))
vi.mock('@milkdown/core', async () => {
  const core = await vi.importActual<typeof import('@milkdown/core')>('@milkdown/core')
  return { ...core, Editor: { make: () => {
    const entry = milkdown.entry
    let created: ((status: unknown) => void) | null = null
    const editor = {
      status: core.EditorStatus.Created,
      onStatusChange: (callback: (status: unknown) => void) => { created = callback; return editor },
      config: (configure: (context: any) => void) => {
        configure({
          set: (key: unknown, value: unknown) => { if (key === core.defaultValueCtx) entry.markdown = value },
          update: (key: unknown, update: (value: any[]) => any[]) => { const result = update([]); if (key === core.prosePluginsCtx) entry.plugin = result.at(-1) },
          get: (key: unknown) => key === core.serializerCtx ? () => entry.markdown : undefined
        })
        created?.(core.EditorStatus.Created)
        return editor
      },
      use: () => editor
    }
    return editor
  } } }
})
vi.mock('@milkdown/react', async () => {
  const ReactModule = await import('react')
  const Context = ReactModule.createContext<any>(null)
  return {
    MilkdownProvider: ({ children }: { children: React.ReactNode }) => {
      const [, redraw] = ReactModule.useState(0)
      const entry = ReactModule.useRef<any>({ markdown: '', plugin: null, editor: null })
      entry.current.redraw = () => redraw(value => value + 1)
      return ReactModule.createElement(Context.Provider, { value: entry.current }, children)
    },
    useEditor: (factory: (root: HTMLElement) => unknown, dependencies: React.DependencyList) => {
      const entry = ReactModule.useContext(Context)
      ReactModule.useLayoutEffect(() => {
        milkdown.entry = entry
        entry.editor = factory(document.createElement('div'))
        if (entry.editor) entry.redraw()
        milkdown.entry = null
      }, dependencies)
      return { get: () => entry.editor, loading: false }
    },
    Milkdown: () => {
      const entry = ReactModule.useContext(Context)
      return ReactModule.createElement('textarea', {
        'aria-label': 'fixture note document', value: entry.markdown,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          entry.markdown = event.target.value
          const view = { state: { doc: {} } }
          entry.plugin.spec.view(view).update(view, { doc: { eq: () => false } })
          entry.redraw()
        }
      })
    }
  }
})
vi.mock('../../../src/renderer/src/features/notes/noteEditorPlugins', () => ({ loadNoteEditorPlugins: async () => [], NOTE_EDITOR_PLUGINS: [] }))
vi.mock('../../../src/renderer/src/features/notes/noteFormatting', () => ({ EMPTY_NOTE_FORMAT_STATE: {}, getNoteFormatState: () => ({}) }))
vi.mock('../../../src/renderer/src/features/notes/NoteToolbar', () => ({ NoteToolbar: () => null }))
vi.mock('../../../src/renderer/src/features/materials/WhiteboardsGroup', () => ({ WhiteboardsGroup: () => null }))
vi.mock('../../../src/renderer/src/features/widgets/WidgetDock', () => ({ WidgetDock: () => null }))
vi.mock('../../../src/renderer/src/features/materials/useMaterialsPaste', () => ({ useMaterialsPaste: () => ({ pasteNotice: null, isPasting: false, onPaste: () => {} }) }))
vi.mock('../../../src/renderer/src/features/workspace/openMaterial', () => ({ openMaterialInWorkspace: vi.fn(), openMaterialInCourse: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  closeResourceTabs: vi.fn(), reconcileWorkspaceMaterialRename: vi.fn(() => 1),
  useWorkspaceStore: { getState: () => ({ openTabs: {} }) }
}))
vi.mock('../../../src/renderer/src/features/materials/MaterialTree', async () => {
  const ReactModule = await import('react')
  return {
    MaterialSearchResults: () => null,
    MaterialTree: ({ onRename }: { onRename: (node: unknown, name: string) => Promise<unknown> }) => ReactModule.createElement('button', {
      onClick: () => void onRename({ kind: 'note', name: 'moving.md', relPath: 'moving.md' }, 'renamed.md')
    }, 'rename source note')
  }
})

import NoteTab from '../../../src/renderer/src/features/notes/NoteTab'
import { MaterialsSidebar } from '../../../src/renderer/src/features/materials/MaterialsSidebar'
import { flushOpenNoteSession, openNoteRefForPanel } from '../../../src/renderer/src/features/notes/noteSessionRegistry'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { useMaterialsStore } from '../../../src/renderer/src/stores/materialsStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const source: Course = { id: 'rename-source', name: 'Source', folderPath: '/fixture/source', color: '#123456', createdAt: '2026-10-07', archivedAt: null, deletedAt: null, missing: false } as Course
const ref: NoteRef = { courseId: source.id, relPath: 'moving.md' }
let root: Root | null = null
let host: HTMLDivElement

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); await Promise.resolve() })
  root = null
  document.body.replaceChildren()
  setIpcAdapter(null)
  milkdown.entry = null
})

async function renderFixture(markdown: string, rename: () => Promise<NoteRenameResponse>) {
  let stored = { markdown, mtime: 1, relPath: ref.relPath }
  const writes: any[] = []
  const invoke = vi.fn(async (channel: string, input: any) => {
    if (channel === 'notes:read') return { ...input, markdown: stored.markdown, mtime: stored.mtime }
    if (channel === 'notes:rename') { const result = await rename(); stored = { markdown: result.markdown, mtime: result.mtime, relPath: result.relPath }; return result }
    if (channel === 'notes:write') { writes.push(input); stored = { markdown: input.markdown, relPath: input.relPath, mtime: stored.mtime + 1 }; return { mtime: stored.mtime } }
    const tree = [{ kind: 'note', name: stored.relPath, relPath: stored.relPath }]
    if (channel === 'materials:snapshot') return { tree }
    if (channel === 'materials:tree') return tree
    if (channel === 'canvas:list') return []
    return { ok: true }
  })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  useMaterialsStore.getState().clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  function Fixture(): JSX.Element {
    const [hidden, setHidden] = useState(false)
    const [descriptor, setDescriptor] = useState({ kind: 'note', payload: ref })
    const [api] = useState(() => ({
      id: 'retained-note-panel', updateParameters: (parameters: any) => setDescriptor(parameters.descriptor), setTitle: vi.fn(),
      onDidActiveChange: () => ({ dispose: () => {} })
    }))
    return <><button onClick={() => setHidden(true)}>move and hide retained note</button>
      <div data-content-course={hidden ? 'destination' : source.id} hidden={hidden}><NoteTab api={api as any} containerApi={{} as any} params={{ descriptor }} /></div>
      <MaterialsSidebar course={source} /></>
  }
  await act(async () => { root!.render(<Fixture />); await Promise.resolve() })
  await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('[aria-label="fixture note document"]')?.value).toBe(markdown))
  await vi.waitFor(() => expect(button('rename source note')).toBeDefined())
  const note = host.querySelector('.note-tab')!
  await act(async () => button('move and hide retained note').click())
  expect(note.closest('[hidden]')).not.toBeNull()
  return { invoke, writes, note, stored: () => stored }
}
function button(text: string): HTMLButtonElement { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)! }
function edit(markdown: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="fixture note document"]')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, markdown)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

test('sidebar rename advances a live hidden moved note to canonical H1 and repointed bytes before its next save', async () => {
  const canonical = '# renamed\n\n[Self](renamed.md)\n'
  const fixture = await renderFixture('# moving\n\n[Self](moving.md)\n', async () => ({ relPath: 'renamed.md', title: 'renamed', markdown: canonical, mtime: 2 }))
  await act(async () => { button('rename source note').click(); await Promise.resolve() })
  await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('[aria-label="fixture note document"]')?.value).toBe(canonical))
  expect(host.querySelector('.note-tab')).toBe(fixture.note)
  expect(openNoteRefForPanel('retained-note-panel')).toEqual({ courseId: source.id, relPath: 'renamed.md' })
  await act(async () => { expect((await flushOpenNoteSession({ courseId: source.id, relPath: 'renamed.md' }))?.result.status).toBe('saved') })
  expect(fixture.writes).toHaveLength(0)
  await act(async () => { edit(`${canonical}\nNew body`); await flushOpenNoteSession({ courseId: source.id, relPath: 'renamed.md' }) })
  expect(fixture.writes).toEqual([{ courseId: source.id, relPath: 'renamed.md', expectedMtime: 2, markdown: `${canonical}\nNew body` }])
  expect(fixture.invoke.mock.calls.filter(([channel]) => channel === 'notes:rename')).toHaveLength(1)
  expect(fixture.stored().markdown).toBe(`${canonical}\nNew body`)
})

test('sidebar rename retains a body edit made during the request and advances a collision-selected title', async () => {
  let resolveRename!: (result: NoteRenameResponse) => void
  const pending = new Promise<NoteRenameResponse>(resolve => { resolveRename = resolve })
  const fixture = await renderFixture('# moving\n\nOriginal body', () => pending)
  await act(async () => { button('rename source note').click(); await Promise.resolve() })
  await vi.waitFor(() => expect(fixture.invoke.mock.calls.filter(([channel]) => channel === 'notes:rename')).toHaveLength(1))
  await act(async () => edit('# moving\n\nConcurrent body'))
  await act(async () => { resolveRename({ relPath: 'renamed-2.md', title: 'renamed-2', markdown: '# renamed-2\n\nOriginal body', mtime: 2 }); await pending })
  await vi.waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('[aria-label="fixture note document"]')?.value).toBe('# renamed-2\n\nConcurrent body'))
  expect(host.querySelector('.note-tab')).toBe(fixture.note)
  await act(async () => { await flushOpenNoteSession({ courseId: source.id, relPath: 'renamed-2.md' }) })
  expect(fixture.writes).toEqual([{ courseId: source.id, relPath: 'renamed-2.md', expectedMtime: 2, markdown: '# renamed-2\n\nConcurrent body' }])
})
