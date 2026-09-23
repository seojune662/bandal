// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyPageImage, pageImageSize } from '../../src/renderer/src/features/pageImageCopy/pageImage'
import { usePageImageCopy } from '../../src/renderer/src/features/pageImageCopy/usePageImageCopy'
import { renderPdfPageImage } from '../../src/renderer/src/features/pdf/lib/renderPageImage'
import { captureInkSnapshot } from '../../src/renderer/src/features/ink/renderInkSnapshot'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../../src/renderer/src/features/ink/renderInkSnapshot', () => ({ captureInkSnapshot: vi.fn(() => null) }))
vi.mock('../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))

const write = vi.fn(async () => {})
const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' }
let node: HTMLElement
let root: Root | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(captureInkSnapshot).mockReturnValue(null)
  node = document.createElement('section')
  node.tabIndex = -1
  document.body.append(node)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
  vi.stubGlobal('ClipboardItem', class { constructor(readonly data: Record<string, Blob>) {} })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('page image output', () => {
  it.each([
    [720, 540, 1600, 1200], [595, 842, 1600, 2264], [100, 1000, 410, 4096], [2000, 100, 1600, 80]
  ])('bounds %sx%s without changing orientation', (w, h, width, height) => {
    expect(pageImageSize(w, h)).toEqual({ width, height })
  })
  it.each([0, -1, NaN, Infinity])('rejects invalid dimensions %s', (value) => {
    expect(() => pageImageSize(value, 100)).toThrow()
  })
  it('writes one PNG on white paper and releases only owned resources', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600; canvas.height = 1200
    const release = vi.fn()
    await copyPageImage({ node, label: '2 페이지', render: async () => ({ canvas, release }) }, false, new AbortController().signal)
    expect(context.fillStyle).toBe('white')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200)
    expect(write).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(canvas.width).toBe(1600)
  })
  it('does not touch the clipboard on render or PNG encoding failure', async () => {
    const abort = new AbortController()
    await expect(copyPageImage({ node, label: 'page', render: async () => { throw new Error('render failed') } }, false, abort.signal)).rejects.toThrow('자료를 다시 열고')
    const release = vi.fn()
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null))
    await expect(copyPageImage({ node, label: 'page', render: async () => ({ canvas: document.createElement('canvas'), release }) }, false, abort.signal)).rejects.toThrow('다시 시도')
    expect(write).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })
  it('caps even a PPTX bitmap whose rounded width made its height exceed 4096', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 410; canvas.height = 4100
    await copyPageImage({ node, label: 'slide', render: async () => ({ canvas }) }, false, new AbortController().signal)
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 410, 4096)
  })
  it('explains clipboard denial and still releases the rendered bitmap', async () => {
    write.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const release = vi.fn()
    await expect(copyPageImage({ node, label: 'page', render: async () => ({ canvas: document.createElement('canvas'), release }) }, false, new AbortController().signal)).rejects.toThrow('앱을 활성화하고 다시 시도')
    expect(release).toHaveBeenCalledOnce()
  })
  it('preserves the clipboard when an annotation image cannot be decoded', async () => {
    vi.mocked(captureInkSnapshot).mockReturnValue(async () => { throw new Error('decode failed') })
    const release = vi.fn()
    await expect(copyPageImage({ node, label: 'page', render: async () => ({ canvas: document.createElement('canvas'), release }) }, true, new AbortController().signal)).rejects.toThrow('필기를 이미지로 만들지 못했어요')
    expect(write).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })
  it('checks cancellation again after encoding and cleans up', async () => {
    const abort = new AbortController()
    const release = vi.fn()
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { abort.abort(); callback(new Blob(['png'])) })
    await expect(copyPageImage({ node, label: 'page', render: async () => ({ canvas: document.createElement('canvas'), release }) }, false, abort.signal)).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })
  it('cancels only the separate PDF render, leaving the open document intact', async () => {
    const abort = new AbortController()
    let rejectRender!: (error: Error) => void
    const cancel = vi.fn(() => rejectRender(new Error('cancelled')))
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: vi.fn(() => ({ promise: new Promise<void>((_, reject) => { rejectRender = reject }), cancel })), cleanup: vi.fn() }
    const pdf = { getPage: vi.fn(async () => page), destroy: vi.fn() }
    const pending = renderPdfPageImage(pdf as unknown as PDFDocumentProxy, 3, abort.signal)
    await Promise.resolve()
    abort.abort()
    await expect(pending).rejects.toThrow('cancelled')
    expect(pdf.getPage).toHaveBeenCalledWith(3)
    expect(cancel).toHaveBeenCalledOnce()
    expect(page.render.mock.calls[0]![0].canvas.width).toBe(0)
    expect(page.cleanup).not.toHaveBeenCalled()
    expect(pdf.destroy).not.toHaveBeenCalled()
  })
})

describe('shared page menu', () => {
  function Harness({ identity = 'first', render, disabledReason }: { identity?: string; render?: (signal: AbortSignal) => Promise<{ canvas: HTMLCanvasElement }>; disabledReason?: string }): JSX.Element {
    const copy = usePageImageCopy(identity)
    return <><section data-testid="page" tabIndex={-1} onContextMenu={(event) => copy.openMenu(event, { label: '3 페이지', render, disabledReason })}><input /><div contentEditable suppressContentEditableWarning>한글 메모</div></section>{copy.overlay}</>
  }
  async function mount(props: React.ComponentProps<typeof Harness> = {}): Promise<HTMLElement> {
    root ??= createRoot(node)
    await act(async () => root!.render(<Harness {...props} />))
    return node.querySelector('section')!
  }
  async function menu(target: Element): Promise<void> {
    await act(async () => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10000, clientY: 10000 })) })
  }
  it('preserves native editing menus and restores clicked-page focus on Escape', async () => {
    const page = await mount()
    for (const editor of page.querySelectorAll('input,[contenteditable]')) {
      await menu(editor)
      expect(document.querySelector('[role=menu]')).toBeNull()
    }
    await menu(page)
    const popup = document.querySelector<HTMLElement>('[role=menu]')!
    expect(parseFloat(popup.style.left)).toBeLessThan(window.innerWidth)
    expect(parseFloat(popup.style.top)).toBeLessThan(window.innerHeight)
    const buttons = popup.querySelectorAll('button')
    expect(document.activeElement).toBe(buttons[0])
    await act(async () => { popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(buttons[1])
    await act(async () => { popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role=menu]')).toBeNull()
    expect(document.activeElement).toBe(page)
  })
  it('explains why legacy preview copy is disabled', async () => {
    await menu(await mount({ disabledReason: '간단 미리보기에서는 이미지 복사를 지원하지 않아요.' }))
    expect(document.querySelector('[role=menu]')?.textContent).toContain('간단 미리보기')
    expect([...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].every((button) => button.disabled)).toBe(true)
  })
  it.each(['replace', 'unmount'])('cancels on %s and blocks a second job while busy', async (action) => {
    let finish!: (result: { canvas: HTMLCanvasElement }) => void
    let signal!: AbortSignal
    const render = vi.fn((input: AbortSignal) => { signal = input; return new Promise<{ canvas: HTMLCanvasElement }>((resolve) => { finish = resolve }) })
    const page = await mount({ render })
    await menu(page)
    await act(async () => document.querySelector<HTMLButtonElement>('[role=menuitem]')!.click())
    expect(document.querySelector('[role=status]')).not.toBeNull()
    await menu(page)
    expect(document.querySelector('[role=menu]')).toBeNull()
    expect(render).toHaveBeenCalledOnce()
    if (action === 'replace') await mount({ identity: 'next', render })
    else { await act(async () => root!.unmount()); root = undefined }
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ canvas: document.createElement('canvas') }))
    expect(write).not.toHaveBeenCalled()
  })
})
