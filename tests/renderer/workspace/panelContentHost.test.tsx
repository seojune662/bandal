// @vitest-environment jsdom
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { DockviewApi, DockviewPanelApi, IDockviewPanelProps } from 'dockview'
import { rebindPanelContent, resetPanelContentForTests, WorkspaceContentLayer, WorkspacePanelSlot } from '../../../src/renderer/src/features/workspace/panelContentHost'
import { WorkspaceCourseContext, useWorkspacePlacement } from '../../../src/renderer/src/features/workspace/placementContext'

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
vi.stubGlobal('cancelAnimationFrame', vi.fn())

function api(): DockviewPanelApi {
  const events = new Map<string, Set<(event: unknown) => void>>()
  const value: Record<string, unknown> = { id: 'note:original:draft.md', component: 'note', isActive: true, isVisible: true, title: 'draft',
    getParameters: () => ({}),
    updateParameters: (parameters: unknown) => { for (const listener of events.get('onDidParametersChange') ?? []) listener(parameters) },
    setActive: vi.fn(), setTitle: vi.fn() }
  for (const name of ['onDidActiveChange', 'onDidVisibilityChange', 'onDidTitleChange', 'onDidDimensionsChange', 'onDidParametersChange']) {
    value[name] = (listener: (event: unknown) => void) => { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(listener); return { dispose: () => set.delete(listener) } }
  }
  return value as unknown as DockviewPanelApi
}
afterEach(() => { resetPanelContentForTests(); document.body.replaceChildren() })

test('moving a slot preserves the same React mount and editor DOM with its unsaved draft', async () => {
  let mounts = 0, unmounts = 0
  function Content(props: IDockviewPanelProps) {
    const placement = useWorkspacePlacement()
    useEffect(() => { mounts++; return () => { unmounts++ } }, [])
    return <label data-placement={placement?.courseId}><input defaultValue="draft" /><span>{props.params.descriptor.payload.courseId}</span></label>
  }
  const source = api(), target = api()
  const container = {} as DockviewApi
  const sourceProps = { api: source, containerApi: container, params: { descriptor: { kind: 'note', payload: { courseId: 'original', relPath: 'draft.md' } } } }, targetProps = { ...sourceProps, api: target }
  const element = document.createElement('div'); element.className = 'workspace-host'; document.body.append(element)
  const root = createRoot(element)
  const render = (moved: boolean): JSX.Element => <>
    <WorkspaceCourseContext.Provider value={moved ? 'destination' : 'original'}><WorkspacePanelSlot key={moved ? 'target' : 'source'} {...(moved ? targetProps : sourceProps)} /></WorkspaceCourseContext.Provider>
    <WorkspaceContentLayer components={{ note: Content }} activeCourseId={moved ? 'destination' : 'original'} active />
  </>
  await act(async () => { root.render(render(false)) })
  const editor = element.querySelector('input')!
  editor.value = 'unsaved exact instance'
  await act(async () => { source.updateParameters({ assistant: { open: true } }) })
  expect(element.querySelector('input')).toBe(editor)
  await act(async () => { rebindPanelContent(source, target, container, 'destination'); root.render(render(true)) })
  expect(element.querySelector('input')).toBe(editor)
  expect(editor.value).toBe('unsaved exact instance')
  expect(element.querySelector('label')?.dataset.placement).toBe('destination')
  expect(element.querySelector('span')?.textContent).toBe('original')
  expect(mounts).toBe(1); expect(unmounts).toBe(0)
  await act(async () => { root.unmount() })
  expect(unmounts).toBe(1)
})
