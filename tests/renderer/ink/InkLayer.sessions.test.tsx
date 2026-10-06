// @vitest-environment jsdom
import React, { act, forwardRef, useImperativeHandle } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import type { InkTool } from '../../../src/renderer/src/features/ink/inkToolStore'
import { InkLayer } from '../../../src/renderer/src/features/ink/InkLayer'
import { useTextFormatStore } from '../../../src/renderer/src/features/ink/textFormatStore'

const editors = vi.hoisted(() => [] as Array<{
  text: string
  onChange: (text: string, runs: [], height: number) => void
  onBlur: (event: { relatedTarget: null; currentTarget: HTMLElement }) => void
  onCommit: () => void
  onCancel: () => void
}>)
vi.mock('../../../src/renderer/src/features/ink/TextBoxEditor', () => ({
  TextBoxEditor: forwardRef(function Editor(props: typeof editors[number], ref) {
    editors.push(props)
    useImperativeHandle(ref, () => ({ focus: vi.fn(), apply: vi.fn() }))
    return <div role="textbox" tabIndex={0}>{props.text}</div>
  })
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const style = { color: 'ink' as const, width: 0.006, opacity: 1 }
const shapes: DrawingShape[] = ['first', 'second'].map((text, index) => ({
  id: text,
  kind: 'textbox',
  data: { text, box: { x: 0.1 + index * 0.4, y: 0.2, width: 0.25, height: 0.08 } },
  style,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}))
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let onCreate: ReturnType<typeof vi.fn>
let onUpdate: ReturnType<typeof vi.fn>
let onRemove: ReturnType<typeof vi.fn>
function render(activeTool: InkTool = 'text', interactive = true, nextShapes = shapes, resolveShapeId?: (id: string) => string): void {
  act(() => root.render(<InkLayer aspect={0.75} baseWidthPx={800} shapes={nextShapes}
    tool={{ activeTool, ...style }} onCreate={onCreate} onUpdate={onUpdate}
    onRemove={onRemove} interactive={interactive} resolveShapeId={resolveShapeId} ariaLabel="session test" />))
  const svg = container.querySelector('svg')!
  Object.defineProperties(svg, {
    getBoundingClientRect: { configurable: true, value: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) }
  })
}
function pointer(target: Element, type: string, clientX = 100, clientY = 300): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.defineProperties(event, { pointerId: { value: 1 }, pressure: { value: 0.5 } })
  act(() => target.dispatchEvent(event))
}
function edit(id: string): void {
  act(() => container.querySelector(`[data-shape-id="${id}"] foreignObject`)!
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
}
function current(): typeof editors[number] { return editors.at(-1)! }
beforeEach(() => {
  editors.length = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onCreate = vi.fn()
  onUpdate = vi.fn()
  onRemove = vi.fn()
  render()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

test('opening a saved box commits a draft once and rejects the old editor blur', () => {
  pointer(container.querySelector('svg')!, 'pointerdown')
  const draft = current()
  act(() => draft.onChange('new memo', [], 24))
  edit('first')
  expect(container.querySelectorAll('[role="textbox"]')).toHaveLength(1)
  expect(current().text).toBe('first')
  expect(onCreate).toHaveBeenCalledTimes(1)
  expect(onCreate.mock.calls[0]![0].data.text).toBe('new memo')
  act(() => draft.onBlur({ relatedTarget: null, currentTarget: container }))
  expect(container.querySelector('[role="textbox"]')!.textContent).toBe('first')
  expect(onUpdate).not.toHaveBeenCalled()
})

test('switching between saved boxes saves each draft under its own id', () => {
  edit('first')
  const first = current()
  act(() => first.onChange('first revised', [], 30))
  edit('second')
  expect(onUpdate).toHaveBeenLastCalledWith('first', expect.objectContaining({
    data: expect.objectContaining({ text: 'first revised' })
  }))
  expect(current().text).toBe('second')
  act(() => first.onChange('late stale content', [], 90))
  act(() => first.onCommit())
  expect(current().text).toBe('second')
  act(() => current().onChange('second revised', [], 32))
  act(() => current().onCommit())
  expect(onUpdate).toHaveBeenLastCalledWith('second', expect.objectContaining({
    data: expect.objectContaining({ text: 'second revised' })
  }))
  expect(container.querySelectorAll('[role="textbox"]')).toHaveLength(0)
})

test('a tool change commits a draft even if native blur does not occur', () => {
  pointer(container.querySelector('svg')!, 'pointerdown')
  act(() => current().onChange('save on switch', [], 24))
  render('select')
  expect(onCreate).toHaveBeenCalledTimes(1)
  expect(onCreate.mock.calls[0]![0].data.text).toBe('save on switch')
  expect(container.querySelector('[role="textbox"]')).toBeNull()
})

test('double clicking the active box preserves its unsaved document', () => {
  edit('first')
  act(() => current().onChange('unsaved revision', [], 24))
  edit('first')
  expect(current().text).toBe('unsaved revision')
  expect(onUpdate).not.toHaveBeenCalled()
})

test('Escape discards edits and an empty committed box deletes only its owner', () => {
  edit('first')
  act(() => current().onChange('cancel me', [], 24))
  act(() => current().onCancel())
  expect(onUpdate).not.toHaveBeenCalled()
  expect(onRemove).not.toHaveBeenCalled()
  edit('second')
  act(() => current().onChange('', [], 24))
  act(() => current().onCommit())
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(['second'])
})

test('deactivation saves the editor and blocks new editing', () => {
  edit('first')
  act(() => current().onChange('save on deactivate', [], 24))
  render('text', false)
  expect(onUpdate).toHaveBeenCalledTimes(1)
  edit('second')
  pointer(container.querySelector('svg')!, 'pointerdown')
  expect(container.querySelector('[role="textbox"]')).toBeNull()
})

test('unmounting a page saves its active draft once', () => {
  pointer(container.querySelector('svg')!, 'pointerdown')
  act(() => current().onChange('save on unmount', [], 24))
  act(() => root.render(null))
  expect(onCreate).toHaveBeenCalledTimes(1)
  expect(onCreate.mock.calls[0]![0].data.text).toBe('save on unmount')
})

test('immediate commit includes the final text and measured height', () => {
  edit('first')
  act(() => {
    current().onChange('last keystroke', [], 72)
    current().onCommit()
  })
  expect(onUpdate).toHaveBeenLastCalledWith('first', expect.objectContaining({
    data: expect.objectContaining({ text: 'last keystroke', box: expect.objectContaining({ height: 0.12 }) })
  }))
})


test('a captured double click on the SVG edits the box under its coordinates', () => {
  render('select')
  act(() => container.querySelector('svg')!.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true, clientX: 150, clientY: 140
  })))
  expect(current().text).toBe('first')
})

test('another page can take focus without leaving the prior draft open', () => {
  pointer(container.querySelector('svg')!, 'pointerdown')
  act(() => current().onChange('prior page text', [], 24))
  const outside = document.createElement('button')
  document.body.append(outside)
  pointer(outside, 'pointerdown')
  expect(onCreate).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[role="textbox"]')).toBeNull()
  outside.remove()
})

test('a pending box keeps its editor DOM and draft when its saved id arrives', () => {
  const pending = { ...shapes[0]!, id: 'pending:box' }
  const resolveId = (id: string): string => id
  render('text', true, [pending], resolveId)
  edit('pending:box')
  act(() => current().onChange('typing during save', [], 24))
  const before = container.querySelector('[role="textbox"]')
  render('text', true, [{ ...pending, id: 'saved-box' }],
    (id) => id === 'pending:box' ? 'saved-box' : id)
  expect(container.querySelector('[role="textbox"]')).toBe(before)
  expect(current().text).toBe('typing during save')
  act(() => current().onCommit())
  expect(onUpdate).toHaveBeenLastCalledWith('saved-box', expect.objectContaining({
    data: expect.objectContaining({ text: 'typing during save' })
  }))
})


test('an object-wide style change clears only the corresponding inline overrides', () => {
  render('select', true, [{ ...shapes[0]!, data: { ...shapes[0]!.data, textRuns: [{
    from: 0, to: 5, style: { bold: false, color: 'blue' }
  }] } }])
  pointer(container.querySelector('foreignObject')!, 'pointerdown', 150, 140)
  pointer(container.querySelector('svg')!, 'pointerup', 150, 140)
  act(() => useTextFormatStore.getState().target!.apply({ bold: true }))
  expect(onUpdate).toHaveBeenLastCalledWith('first', expect.objectContaining({
    style: expect.objectContaining({ bold: true }),
    data: expect.objectContaining({ textRuns: [{ from: 0, to: 5, style: { color: 'blue' } }] })
  }))
})

test('a drag remains attached to its box when a pending id becomes durable', () => {
  const pending = { ...shapes[0]!, id: 'pending:move' }
  render('select', true, [pending], (id) => id)
  pointer(container.querySelector('foreignObject')!, 'pointerdown', 150, 140)
  render('select', true, [{ ...pending, id: 'saved-move' }],
    (id) => id === 'pending:move' ? 'saved-move' : id)
  pointer(container.querySelector('svg')!, 'pointerup', 198, 140)
  expect(onUpdate).toHaveBeenLastCalledWith('saved-move', expect.objectContaining({
    data: expect.objectContaining({ text: 'first', box: expect.objectContaining({ x: 0.16 }) })
  }))
})
