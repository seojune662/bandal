// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { installWorkspaceChromeInsets, updateWorkspaceHeaderChromeInsets, workspaceContentTopInset } from '../../../src/renderer/src/features/workspace/windowChromeInsets'

afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.platform
  delete document.documentElement.dataset.fullscreen
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function box(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height)
}

function fixture(): { shell: HTMLElement; host: HTMLElement; left: HTMLElement; right: HTMLElement; addHeader: (rect: DOMRect, hidden?: boolean) => HTMLElement } {
  document.body.innerHTML = '<div class="app-shell"><header class="shell-chrome"></header><div class="workspace-controls"></div><main class="workspace-host"></main></div>'
  const shell = document.querySelector<HTMLElement>('.app-shell')!
  const host = shell.querySelector<HTMLElement>('.workspace-host')!
  const left = shell.querySelector<HTMLElement>('.shell-chrome')!
  const right = shell.querySelector<HTMLElement>('.workspace-controls')!
  vi.spyOn(left, 'getBoundingClientRect').mockReturnValue(box(0, 0, 132, 44))
  vi.spyOn(right, 'getBoundingClientRect').mockReturnValue(box(884, 5, 108, 34))
  vi.stubGlobal('innerWidth', 1000)
  return { shell, host, left, right, addHeader(rect, hidden = false) {
    const workspace = document.createElement('div')
    workspace.className = 'workspace-course'
    workspace.hidden = hidden
    workspace.innerHTML = '<div class="dv-groupview"><div class="dv-tabs-and-actions-container"></div></div>'
    host.append(workspace)
    const header = workspace.querySelector<HTMLElement>('.dv-tabs-and-actions-container')!
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(rect)
    return header
  } }
}

function insets(header: HTMLElement): [string, string] {
  return [header.style.getPropertyValue('--workspace-chrome-left'), header.style.getPropertyValue('--workspace-chrome-right')]
}

test('only the top corner panes reserve horizontal space for fixed controls', () => {
  const { host, addHeader } = fixture()
  const topLeft = addHeader(box(0, 0, 480, 44))
  const topRight = addHeader(box(488, 0, 512, 44))
  const bottom = addHeader(box(0, 408, 1000, 44))
  const hidden = addHeader(box(0, 0, 1000, 44), true)
  expect(updateWorkspaceHeaderChromeInsets(host)).toBe(true)
  expect(insets(topLeft)).toEqual(['132px', '0px'])
  expect(insets(topRight)).toEqual(['0px', '116px'])
  expect(insets(bottom)).toEqual(['0px', '0px'])
  expect(insets(hidden)).toEqual(['0px', '0px'])
  expect(updateWorkspaceHeaderChromeInsets(host)).toBe(false)
})

test('open sidebars remove corner clearance and partial overlap uses the measured edge', () => {
  const { host, addHeader } = fixture()
  const header = addHeader(box(280, 0, 440, 44))
  updateWorkspaceHeaderChromeInsets(host)
  expect(insets(header)).toEqual(['0px', '0px'])
  vi.mocked(header.getBoundingClientRect).mockReturnValue(box(80, 0, 840, 44))
  updateWorkspaceHeaderChromeInsets(host)
  expect(insets(header)).toEqual(['52px', '36px'])
})

test('Windows narrow sidebars still reserve the overlapping capsule and native caption area', () => {
  const { host, right, addHeader } = fixture()
  document.documentElement.dataset.platform = 'win32'
  vi.mocked(right.getBoundingClientRect).mockReturnValue(box(746, 5, 108, 34))
  const narrowSidebar = addHeader(box(280, 0, 500, 44))
  const captionOnly = addHeader(box(900, 0, 100, 44))
  updateWorkspaceHeaderChromeInsets(host)
  expect(insets(narrowSidebar)).toEqual(['0px', '34px'])
  expect(insets(captionOnly)).toEqual(['0px', '100px'])
  document.documentElement.dataset.fullscreen = 'true'
  updateWorkspaceHeaderChromeInsets(host)
  expect(insets(captionOnly)).toEqual(['0px', '0px'])
})

test('hidden tab content clears only overlapping controls and never adds a global strip', () => {
  fixture()
  expect(workspaceContentTopInset(box(0, 0, 480, 600))).toBe(44)
  expect(workspaceContentTopInset(box(488, 12, 512, 600))).toBe(32)
  expect(workspaceContentTopInset(box(280, 0, 440, 600))).toBe(0)
  expect(workspaceContentTopInset(box(0, 44, 1000, 556))).toBe(0)
  expect(workspaceContentTopInset(box(0, 408, 1000, 192))).toBe(0)
})

test('content under Windows caption buttons clears their row only outside fullscreen', () => {
  const { right } = fixture()
  document.documentElement.dataset.platform = 'win32'
  vi.mocked(right.getBoundingClientRect).mockReturnValue(box(746, 5, 108, 34))
  expect(workspaceContentTopInset(box(900, 0, 100, 600))).toBe(44)
  document.documentElement.dataset.fullscreen = 'true'
  expect(workspaceContentTopInset(box(900, 0, 100, 600))).toBe(0)
})

test('unmounted or hidden controls never retain stale insets', () => {
  const { host, left, right, addHeader } = fixture()
  const header = addHeader(box(0, 0, 1000, 44))
  updateWorkspaceHeaderChromeInsets(host)
  left.style.visibility = 'hidden'
  right.remove()
  updateWorkspaceHeaderChromeInsets(host)
  expect(insets(header)).toEqual(['0px', '0px'])
  expect(workspaceContentTopInset(box(0, 0, 1000, 600))).toBe(0)
})

function observers(): { flush: () => void; resize: () => void; disconnect: ReturnType<typeof vi.fn>; pending: () => number } {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0, resized: ResizeObserverCallback = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized = callback }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = disconnect
  })
  return { flush() { const ready = [...frames.values()]; frames.clear(); ready.forEach(callback => callback(0)) }, resize() { resized([], {} as ResizeObserver) }, disconnect, pending: () => frames.size }
}

test('geometry observation updates hidden-header content, ignores unchanged geometry, and disposes', async () => {
  const { host, right, addHeader } = fixture()
  const header = addHeader(box(0, 0, 0, 0))
  const { flush, resize, disconnect, pending } = observers()
  const onChange = vi.fn()
  const stop = installWorkspaceChromeInsets(host, onChange)
  expect(onChange).toHaveBeenCalledOnce()
  resize(); flush()
  expect(onChange).toHaveBeenCalledOnce()
  vi.mocked(right.getBoundingClientRect).mockReturnValue(box(746, 5, 108, 34))
  document.documentElement.dataset.platform = 'win32'
  await Promise.resolve(); flush()
  expect(onChange).toHaveBeenCalledTimes(2)
  expect(insets(header)).toEqual(['0px', '0px'])
  window.dispatchEvent(new Event('resize'))
  expect(pending()).toBe(1)
  stop()
  expect(pending()).toBe(0)
  expect(disconnect).toHaveBeenCalledOnce()
})

test('sidebar transitions measure every animation frame until their geometry settles', () => {
  const { shell, host, addHeader } = fixture()
  const header = addHeader(box(280, 0, 440, 44))
  const { flush, pending } = observers()
  const stop = installWorkspaceChromeInsets(host)
  const transition = (name: string): void => {
    const event = new Event(name, { bubbles: true })
    Object.defineProperty(event, 'propertyName', { value: 'grid-template-columns' })
    shell.dispatchEvent(event)
  }
  transition('transitionrun')
  vi.mocked(header.getBoundingClientRect).mockReturnValue(box(80, 0, 840, 44))
  flush()
  expect(insets(header)).toEqual(['52px', '36px'])
  expect(pending()).toBe(1)
  vi.mocked(header.getBoundingClientRect).mockReturnValue(box(0, 0, 1000, 44))
  transition('transitionend'); flush()
  expect(insets(header)).toEqual(['132px', '116px'])
  expect(pending()).toBe(0)
  stop()
})
