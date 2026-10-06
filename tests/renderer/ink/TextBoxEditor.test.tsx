// @vitest-environment jsdom

import React, { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DrawingStyle, DrawingTextRun } from '../../../src/shared/types/drawing'
import { TextBoxEditor, type TextBoxEditorHandle } from '../../../src/renderer/src/features/ink/TextBoxEditor'

const capture = vi.hoisted(() => ({ view: null as EditorView | null }))
vi.mock('@milkdown/prose/view', async (importOriginal) => {
  const original = await importOriginal<typeof import('@milkdown/prose/view')>()
  return {
    ...original,
    EditorView: class extends original.EditorView {
      constructor(...args: ConstructorParameters<typeof original.EditorView>) {
        super(...args)
        capture.view = this
      }
    }
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base: DrawingStyle = { color: 'ink', width: 0.006, opacity: 1 }
const enabled: DrawingStyle = { ...base, bold: true, italic: true, underline: true, strike: true }
let root: Root
let host: HTMLDivElement
let frames: FrameRequestCallback[]
const handle = createRef<TextBoxEditorHandle>()
let changed: ReturnType<typeof vi.fn>
let selected: ReturnType<typeof vi.fn>

beforeEach(() => {
  capture.view = null
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] as unknown as DOMRectList },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  changed = vi.fn()
  selected = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(text: string, style = base, runs?: DrawingTextRun[]): EditorView {
  act(() => root.render(
    <TextBoxEditor
      ref={handle}
      text={text}
      {...(runs === undefined ? {} : { runs })}
      baseStyle={style}
      baseWidthPx={800}
      surfaceWidthPt={600}
      contentStyle={{ fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal' }}
      color="ink"
      onChange={changed}
      onSelectionStyleChange={selected}
      onBlur={vi.fn()}
      onCancel={vi.fn()}
      onCommit={vi.fn()}
    />
  ))
  act(() => frames.splice(0).forEach((callback) => callback(0)))
  return capture.view!
}

function select(view: EditorView, from: number, to: number): void {
  act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))))
}

function latest(): { text: string; runs: DrawingTextRun[] } {
  const [text, runs] = changed.mock.calls.at(-1)!
  return { text, runs }
}

describe('textbox rich text editor', () => {
  test('preserves explicit false overrides when opening and serializing a styled box', () => {
    mount('ABCD', enabled, [{
      from: 1, to: 3,
      style: { bold: false, italic: false, underline: false, strike: false }
    }])
    expect(latest()).toEqual({ text: 'ABCD', runs: [{
      from: 1, to: 3,
      style: { bold: false, italic: false, underline: false, strike: false }
    }] })
    expect(host.querySelector('.ink-layer__textbox-editor')?.getAttribute('style')).toContain('font-weight: 400')
    expect(host.querySelector('strong')?.textContent).toBe('A')
    const view = capture.view!
    select(view, 1, 3)
    expect(selected.mock.calls.at(-1)?.[0]).toMatchObject({ bold: false, italic: false, underline: false, strike: false })
  })

  test('turns inherited formatting off for a range and restores it through local undo', () => {
    const view = mount('ABCD', enabled)
    select(view, 1, 3)
    act(() => handle.current!.apply({ bold: false, italic: false, underline: false, strike: false }))
    expect(latest().runs).toEqual([{ from: 1, to: 3, style: {
      bold: false, italic: false, underline: false, strike: false
    } }])
    act(() => view.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true })))
    expect(latest().runs).toEqual([])
    act(() => view.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true })))
    expect(latest().runs[0]?.style).toMatchObject({ bold: false, italic: false, underline: false, strike: false })
  })

  test('applies caret formatting to the whole box and keeps it off for later typing', () => {
    const view = mount('AB', enabled)
    act(() => handle.current!.apply({ bold: false, italic: false, underline: false, strike: false }))
    act(() => view.dispatch(view.state.tr.insertText('C')))
    expect(latest()).toEqual({ text: 'ABC', runs: [{ from: 0, to: 3, style: {
      bold: false, italic: false, underline: false, strike: false
    } }] })
  })

  test('starts an empty styled box with the same formatting as its first typed text', () => {
    const view = mount('', enabled)
    expect(selected.mock.calls.at(-1)?.[0]).toMatchObject({ bold: true, italic: true, underline: true, strike: true })
    act(() => view.dispatch(view.state.tr.insertText('메모')))
    expect(latest()).toEqual({ text: '메모', runs: [] })
    expect(host.querySelector('strong')?.textContent).toBe('메모')
  })

  test('toggles inherited bold off at the caret and keeps it off after a line break', () => {
    const view = mount('A', { ...base, bold: true })
    act(() => view.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })))
    expect(selected.mock.calls.at(-1)?.[0]).toMatchObject({ bold: false })
    act(() => view.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => view.dispatch(view.state.tr.insertText('B')))
    expect(latest()).toEqual({ text: 'A\nB', runs: [{ from: 1, to: 3, style: { bold: false } }] })
  })

  test('preserves disabled formatting on a saved trailing line break', () => {
    const view = mount('A\n', { ...base, bold: true }, [{ from: 0, to: 2, style: { bold: false } }])
    expect(selected.mock.calls.at(-1)?.[0]).toMatchObject({ bold: false })
    act(() => view.dispatch(view.state.tr.insertText('B')))
    expect(latest()).toEqual({ text: 'A\nB', runs: [{ from: 0, to: 3, style: { bold: false } }] })
  })

  test('reports formatting on a selection that contains only a line break', () => {
    const view = mount('A\nB', { ...base, bold: true }, [{ from: 1, to: 2, style: { bold: false } }])
    select(view, 1, 2)
    expect(selected.mock.calls.at(-1)?.[0]).toMatchObject({ bold: false })
  })

  test('keeps blank and trailing lines when pasting and copying plain text', () => {
    const view = mount('')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: {
      getData: (type: string) => type === 'text/plain' ? '첫째\r\n\r\n셋째\r\n' : ''
    } })
    act(() => view.dispatchEvent(paste))
    expect(latest()).toEqual({ text: '첫째\n\n셋째\n', runs: [] })
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe('첫째\n\n셋째\n')
  })

  test('retains inline color and point size while disabling inherited bold', () => {
    mount('AB', { ...base, bold: true }, [{ from: 0, to: 1, style: { color: 'red', fontSizePt: 24, bold: false } }])
    expect(latest().runs).toEqual([{ from: 0, to: 1, style: { color: 'red', fontSizePt: 24, bold: false } }])
    expect(host.querySelector('[data-font-size-pt="24"]')?.getAttribute('style')).toContain('font-size: 32px')
  })

  test('preserves paragraph breaks and formatting in pasted HTML', () => {
    const view = mount('')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: {
      getData: (type: string) => type === 'text/html'
        ? '<p>첫째</p><p><strong>둘째</strong></p>'
        : type === 'text/plain' ? '첫째\n둘째' : ''
    } })
    act(() => view.dispatchEvent(paste))
    expect(latest()).toEqual({ text: '첫째\n둘째', runs: [{ from: 3, to: 5, style: { bold: true } }] })
  })

  test('preserves empty paragraphs in nested pasted HTML without indentation spaces', () => {
    const view = mount('')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: {
      getData: (type: string) => type === 'text/html'
        ? '<div>\n<p>A</p>\n<p></p>\n<p><em>B</em></p>\n</div>\n<div>C</div>'
        : type === 'text/plain' ? 'A\n\nB\nC' : ''
    } })
    act(() => view.dispatchEvent(paste))
    expect(latest()).toEqual({ text: 'A\n\nB\nC', runs: [{ from: 3, to: 4, style: { italic: true } }] })
  })

  test('does not turn browser clipboard metadata into a leading empty line', () => {
    const view = mount('')
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: {
      getData: (type: string) => type === 'text/html'
        ? '<meta charset="utf-8"><!--StartFragment--><div><p>메모</p></div><!--EndFragment-->'
        : type === 'text/plain' ? '메모' : ''
    } })
    act(() => view.dispatchEvent(paste))
    expect(latest()).toEqual({ text: '메모', runs: [] })
  })
})
