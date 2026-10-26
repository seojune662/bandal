// @vitest-environment jsdom
import React, { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { IDockviewPanelProps } from 'dockview'
import { useNotePanelViewState } from '../../../src/renderer/src/features/notes/useNotePanelViewState'
import { FLUSH_PANEL_VIEW_STATE, type NotePanelViewState } from '../../../src/renderer/src/features/workspace/panelViewState'

let root: Root, container: HTMLDivElement
const initial = { scrollTop: 230, fontScale: 1.25, mode: 'edit' } as const
function Panel({ id, save, state = initial, visible = true, mode = state?.mode ?? 'edit', fontScale = state?.fontScale ?? 1 }: {
  id: string; save: (value: unknown) => void; state?: NotePanelViewState | null; visible?: boolean; mode?: 'edit' | 'quiz'; fontScale?: number
}): JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  const api = useRef({ id, updateParameters: save } as unknown as IDockviewPanelProps['api'])
  useNotePanelViewState({ root: element, panelApi: api.current, initial: state, visible, ready: true, revision: 1, mode, fontScale })
  return <div ref={element} data-panel={id}><div className={mode === 'quiz' ? 'note-quiz-preview__scroll' : 'note-editor-scroll'} ref={node => {
    if (node) Object.defineProperty(node, 'clientHeight', { configurable: true, value: 500 })
  }} /></div>
}
beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.useRealTimers() })

test('duplicate note panels restore independent scroll positions and keep font/mode local', async () => {
  const leftSave = vi.fn(), rightSave = vi.fn(), rightState = { scrollTop: 840, fontScale: 0.875, mode: 'quiz' } as const
  await act(async () => root.render(<><Panel id="left" save={leftSave} /><Panel id="right" save={rightSave} state={rightState} /></>))
  await act(async () => vi.advanceTimersByTimeAsync(200))
  const left = container.querySelector<HTMLElement>('[data-panel=left] .note-editor-scroll')!, right = container.querySelector<HTMLElement>('[data-panel=right] .note-quiz-preview__scroll')!
  expect(left.scrollTop).toBe(230); expect(right.scrollTop).toBe(840)
  await act(async () => {
    left.scrollTop = 500; left.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event(FLUSH_PANEL_VIEW_STATE))
  })
  expect(leftSave).toHaveBeenLastCalledWith({ noteViewState: { ...initial, scrollTop: 500 } })
  expect(rightSave).toHaveBeenLastCalledWith({ noteViewState: rightState })
  await act(async () => root.render(<><Panel id="left" save={leftSave} mode="quiz" fontScale={1.5} /><Panel id="right" save={rightSave} state={rightState} /></>))
  expect(leftSave).toHaveBeenLastCalledWith({ noteViewState: { scrollTop: 500, fontScale: 1.5, mode: 'quiz' } })
  expect(rightSave).toHaveBeenLastCalledWith({ noteViewState: rightState })
})

test('hidden layout scroll resets do not overwrite the last real panel position', async () => {
  const save = vi.fn()
  await act(async () => root.render(<Panel id="note" save={save} />))
  await act(async () => vi.advanceTimersByTimeAsync(200))
  const scroller = container.querySelector<HTMLElement>('.note-editor-scroll')!
  await act(async () => { scroller.scrollTop = 610; scroller.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event(FLUSH_PANEL_VIEW_STATE)) })
  await act(async () => root.render(<Panel id="note" save={save} visible={false} />))
  await act(async () => { scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('beforeunload')) })
  expect(save).toHaveBeenLastCalledWith({ noteViewState: { ...initial, scrollTop: 610 } })
  await act(async () => root.render(<Panel id="note" save={save} />))
  await act(async () => vi.advanceTimersByTimeAsync(200))
  expect(scroller.scrollTop).toBe(610)
})

test('a user scroll cancels delayed restore and repeated flushes do not rewrite identical params', async () => {
  const save = vi.fn()
  await act(async () => root.render(<Panel id="note" save={save} />))
  const scroller = container.querySelector<HTMLElement>('.note-editor-scroll')!
  await act(async () => {
    scroller.dispatchEvent(new Event('wheel', { bubbles: true }))
    scroller.scrollTop = 90; scroller.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(scroller.scrollTop).toBe(90)
  expect(save).toHaveBeenLastCalledWith({ noteViewState: { ...initial, scrollTop: 90 } })
  const count = save.mock.calls.length
  act(() => { window.dispatchEvent(new Event(FLUSH_PANEL_VIEW_STATE)); window.dispatchEvent(new Event(FLUSH_PANEL_VIEW_STATE)) })
  expect(save).toHaveBeenCalledTimes(count)
})

test('a fresh page-note pane keeps its requested initial page instead of restoring a synthetic zero', async () => {
  const save = vi.fn()
  await act(async () => root.render(<Panel id="note" save={save} state={null} />))
  const scroller = container.querySelector<HTMLElement>('.note-editor-scroll')!
  // PageNoteWorkspace resolves its initial page after the editor's first layout.
  scroller.scrollTop = 1400
  await act(async () => vi.advanceTimersByTimeAsync(200))
  expect(scroller.scrollTop).toBe(1400)
  act(() => window.dispatchEvent(new Event(FLUSH_PANEL_VIEW_STATE)))
  expect(save).toHaveBeenLastCalledWith({ noteViewState: { scrollTop: 1400, fontScale: 1, mode: 'edit' } })
})
