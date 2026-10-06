// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PdfToolRail } from '../../../src/renderer/src/features/pdf/tools/PdfToolRail'
import { usePdfToolStore } from '../../../src/renderer/src/features/pdf/tools/toolStore'
import type { DrawingsApi } from '../../../src/renderer/src/features/pdf/tools/useDrawings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let resize: (() => void)[]

beforeEach(() => {
  resize = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize.push(callback) }
    observe() {}
    disconnect() {}
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  usePdfToolStore.setState({ activeTool: 'select' })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function drawings(): DrawingsApi {
  return {
    drawings: [], byPage: new Map(), loading: false, historyBusy: false,
    canUndo: false, canRedo: false, error: null,
    create: vi.fn(), update: vi.fn(), refine: vi.fn(), remove: vi.fn(),
    undo: vi.fn(), redo: vi.fn()
  }
}

function mount(onExport = vi.fn(async () => {})): void {
  act(() => root.render(
    <PdfToolRail courseId="course" relPath="lecture.pdf" drawingsApi={drawings()} onExport={onExport} />
  ))
}

function button(label: string): HTMLButtonElement {
  const node = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(node, label).not.toBeNull()
  return node!
}

function narrowRail(): HTMLDivElement {
  const shell = host.querySelector<HTMLDivElement>('.pdf-tool-rail-shell')!
  const rail = host.querySelector<HTMLDivElement>('.pdf-tool-rail')!
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 320 })
  Object.defineProperties(rail, {
    clientWidth: { configurable: true, value: 280 },
    scrollWidth: { configurable: true, value: 480 }
  })
  let left = 0
  Object.defineProperty(rail, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => { left = Math.max(0, Math.min(200, value)) }
  })
  rail.scrollBy = vi.fn((options: ScrollToOptions) => {
    rail.scrollLeft += options.left ?? 0
    rail.dispatchEvent(new Event('scroll', { bubbles: true }))
  }) as typeof rail.scrollBy
  act(() => resize.forEach((callback) => callback()))
  return rail
}

describe('PDF drawing tool rail', () => {
  test('offers all tools and export directly without a tools menu', async () => {
    const onExport = vi.fn(async () => {})
    mount(onExport)
    const tools = ['선택', '펜', '형광펜', '지우개', '텍스트', '사각형', '타원', '화살표', '직선']
    for (const label of tools) {
      expect(button(label).closest('.pdf-tool-rail__tools')).not.toBeNull()
    }
    expect(host.querySelector('[aria-label="도형 및 텍스트 도구"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => button('텍스트').click())
    expect(usePdfToolStore.getState().activeTool).toBe('text')
    expect(button('텍스트').getAttribute('aria-pressed')).toBe('true')
    act(() => button('직선').click())
    expect(usePdfToolStore.getState().activeTool).toBe('line')
    expect(button('텍스트').getAttribute('aria-pressed')).toBe('false')
    await act(async () => button('주석 포함 PDF 내보내기').click())
    expect(onExport).toHaveBeenCalledOnce()
  })

  test('navigates an overflowing rail with enabled controls at each edge', () => {
    mount()
    const rail = narrowRail()
    expect(host.querySelector('.pdf-tool-rail-shell')?.getAttribute('data-overflow')).toBe('true')
    expect(button('이전 필기 도구').disabled).toBe(true)
    expect(button('다음 필기 도구').disabled).toBe(false)
    act(() => button('다음 필기 도구').click())
    expect(rail.scrollLeft).toBe(200)
    expect(button('이전 필기 도구').disabled).toBe(false)
    expect(button('다음 필기 도구').disabled).toBe(true)
    act(() => button('이전 필기 도구').click())
    expect(rail.scrollLeft).toBe(0)
    expect(button('이전 필기 도구').disabled).toBe(true)
  })

  test('uses the mouse wheel to reach tools without consuming pinch zoom', () => {
    mount()
    const rail = narrowRail()
    const wheel = new WheelEvent('wheel', { deltaY: 80, cancelable: true })
    act(() => rail.dispatchEvent(wheel))
    expect(wheel.defaultPrevented).toBe(true)
    expect(rail.scrollLeft).toBe(80)
    expect(button('이전 필기 도구').disabled).toBe(false)
    const pinch = new WheelEvent('wheel', { deltaY: 80, ctrlKey: true, cancelable: true })
    act(() => rail.dispatchEvent(pinch))
    expect(pinch.defaultPrevented).toBe(false)
    expect(rail.scrollLeft).toBe(80)
  })

  test('removes navigation when the panel grows enough to show every tool', () => {
    mount()
    narrowRail()
    const shell = host.querySelector<HTMLDivElement>('.pdf-tool-rail-shell')!
    // The full shell width includes the space temporarily occupied by arrows.
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 500 })
    act(() => resize.forEach((callback) => callback()))
    expect(shell.getAttribute('data-overflow')).toBe('false')
    expect(host.querySelector('[aria-label="다음 필기 도구"]')).toBeNull()
    expect(button('직선')).not.toBeNull()
  })
})
