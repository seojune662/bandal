// @vitest-environment jsdom
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DockviewApi, DockviewPanelApi, IDockviewPanelProps } from 'dockview'
import { rebindPanelContent, resetPanelContentForTests, WorkspaceContentLayer, WorkspacePanelSlot } from '../../../src/renderer/src/features/workspace/panelContentHost'
import { WorkspaceCourseContext, useWorkspacePlacement } from '../../../src/renderer/src/features/workspace/placementContext'

const observers = new Set<MockResizeObserver>()
class MockResizeObserver {
  readonly targets = new Set<Element>()
  constructor(readonly callback: () => void) { observers.add(this) }
  observe(target: Element) { this.targets.add(target) }
  disconnect() { this.targets.clear() }
}
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
vi.stubGlobal('ResizeObserver', MockResizeObserver)
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
beforeEach(() => { observers.clear(); frames.clear() })
async function measureFrame() {
  await act(async () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(0))
  })
}
function rect(element: Element, value: () => DOMRect) {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(value)
}

function api(): DockviewPanelApi & { emit(name: string): void } {
  const events = new Map<string, Set<(event: unknown) => void>>()
  const value: Record<string, unknown> = { id: 'note:original:draft.md', component: 'note', isActive: true, isVisible: true, title: 'draft',
    getParameters: () => ({}),
    emit: (name: string) => { for (const listener of events.get(name) ?? []) listener({}) },
    updateParameters: (parameters: unknown) => { for (const listener of events.get('onDidParametersChange') ?? []) listener(parameters) },
    setActive: vi.fn(), setTitle: vi.fn() }
  for (const name of ['onDidActiveChange', 'onDidVisibilityChange', 'onDidTitleChange', 'onDidDimensionsChange', 'onDidParametersChange', 'onDidGroupChange']) {
    value[name] = (listener: (event: unknown) => void) => { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(listener); return { dispose: () => set.delete(listener) } }
  }
  return value as unknown as DockviewPanelApi & { emit(name: string): void }
}
afterEach(() => { resetPanelContentForTests(); document.body.replaceChildren(); frames.clear(); vi.restoreAllMocks() })

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


test('visible content follows its actual group when Dockview retains a zero or stale overlay', async () => {
  const panel = api(), container = {} as DockviewApi
  const host = document.createElement('div'); host.className = 'workspace-host'; document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<>
    <div className="dv-groupview"><div className="dv-content-container" /></div>
    <WorkspacePanelSlot api={panel} containerApi={container} params={{}} />
    <WorkspaceContentLayer components={{ note: () => <input defaultValue="draft" /> }} activeCourseId={null} active />
  </>))
  const group = host.querySelector<HTMLElement>('.dv-groupview')!
  const content = group.firstElementChild!
  Object.assign(panel, { group: { element: group } })
  rect(host, () => new DOMRect(100, 50, 700, 600))
  let bounds = new DOMRect(120, 94, 286, 523)
  rect(content, () => bounds)
  // The slot is initially 0×0, exactly as in the narrow iframe reproduction.
  await measureFrame()
  const live = host.querySelector<HTMLElement>('.workspace-panel-content')!
  expect([live.style.left, live.style.top, live.style.width, live.style.height]).toEqual(['20px', '44px', '286px', '523px'])
  const observer = [...observers].find(observer => observer.targets.has(content))!
  expect(observer).toBeDefined()
  // A group-only resize must not wait for Dockview's stale slot to resize.
  rect(host.querySelector('.workspace-panel-slot')!, () => new DOMRect(120, 94, 286, 523))
  bounds = new DOMRect(130, 94, 240, 500)
  observer.callback()
  await measureFrame()
  expect([live.style.left, live.style.width, live.style.height]).toEqual(['30px', '240px', '500px'])
  // Hidden tabs keep their last useful geometry, including during a zero reflow.
  Object.assign(panel, { isVisible: false })
  await act(async () => panel.emit('onDidVisibilityChange'))
  bounds = new DOMRect()
  observer.callback()
  await measureFrame()
  expect(live.hidden).toBe(true)
  expect(live.style.height).toBe('500px')
  bounds = new DOMRect(140, 94, 300, 480)
  Object.assign(panel, { isVisible: true })
  await act(async () => panel.emit('onDidVisibilityChange'))
  await measureFrame()
  expect(live.hidden).toBe(false)
  expect([live.style.left, live.style.width, live.style.height]).toEqual(['40px', '300px', '480px'])
  await act(async () => root.unmount())
  expect(observer.targets.size).toBe(0)
})

test('moving and reparenting a live panel switches its group observer without losing the editor', async () => {
  const source = api(), target = api(), container = {} as DockviewApi
  const host = document.createElement('div'); host.className = 'workspace-host'; document.body.append(host)
  const root = createRoot(host)
  function Content() { return <input defaultValue="draft" /> }
  const render = (placement: 'source' | 'gap' | 'target') => <>
    <div data-group="source"><div className="dv-content-container" /></div>
    <div data-group="target"><div className="dv-content-container" /></div>
    {placement !== 'gap' && <WorkspaceCourseContext.Provider value={placement}>
      <WorkspacePanelSlot key={placement} api={placement === 'source' ? source : target} containerApi={container} params={{}} />
    </WorkspaceCourseContext.Provider>}
    <WorkspaceContentLayer components={{ note: Content }} activeCourseId={placement === 'source' ? 'source' : 'target'} active />
  </>
  await act(async () => root.render(render('source')))
  const groupA = host.querySelector<HTMLElement>('[data-group="source"]')!, groupB = host.querySelector<HTMLElement>('[data-group="target"]')!
  Object.assign(source, { group: { element: groupA } }); Object.assign(target, { group: { element: groupB } })
  rect(host, () => new DOMRect(50, 100, 800, 600))
  rect(groupA.firstElementChild!, () => new DOMRect(50, 144, 300, 556))
  rect(groupB.firstElementChild!, () => new DOMRect(350, 144, 500, 556))
  await measureFrame()
  const input = host.querySelector('input')!, live = host.querySelector<HTMLElement>('.workspace-panel-content')!
  input.value = 'unsaved during transfer'
  const observer = [...observers].find(observer => observer.targets.has(groupA.firstElementChild!))!
  await act(async () => { rebindPanelContent(source, target, container, 'target'); root.render(render('gap')) })
  await measureFrame()
  expect(input.isConnected).toBe(true)
  expect(live.style.width).toBe('300px')
  await act(async () => root.render(render('target')))
  await measureFrame()
  expect(host.querySelector('input')).toBe(input)
  expect(input.value).toBe('unsaved during transfer')
  expect([live.style.left, live.style.width]).toEqual(['300px', '500px'])
  expect(observer.targets.has(groupA.firstElementChild!)).toBe(false)
  expect(observer.targets.has(groupB.firstElementChild!)).toBe(true)
  // Reparenting inside Dockview keeps the API identity but changes its group.
  Object.assign(target, { group: { element: groupA } })
  await act(async () => target.emit('onDidGroupChange'))
  await measureFrame()
  expect([live.style.left, live.style.width]).toEqual(['0px', '300px'])
  expect(observer.targets.has(groupB.firstElementChild!)).toBe(false)
  expect(observer.targets.has(groupA.firstElementChild!)).toBe(true)
  await act(async () => root.unmount())
  expect(observer.targets.size).toBe(0)
})
