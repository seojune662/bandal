// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { composeWindowPreview, createWindowPreviewController } from '../../../src/renderer/src/features/workspace/windowPreview'
import type { WorkspacePreviewCapture } from '../../../src/shared/ipc/workspacePreviewContract'

const key = { workspaceKey: 'course-1', windowId: 'window-1' }, rect = { x: 100, y: 44, width: 1000, height: 700 }
const snapshot: WorkspacePreviewCapture = { rect, imageDataUrl: 'host', pages: [] }
let element: HTMLDivElement
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
const transport = () => ({ capture: vi.fn(async () => snapshot), read: vi.fn(async () => 'previous'), save: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) })
beforeEach(() => { element = document.createElement('div'); element.getBoundingClientRect = () => rect as DOMRect; document.body.append(element) })
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('captures a fixed source window and notifies after saving its thumbnail', async () => {
  const ipc = transport(), compose = vi.fn(async () => 'new'), controller = createWindowPreviewController(ipc, compose), changed = vi.fn()
  controller.subscribe(changed)
  expect(await controller.capture({ ...key, element, isCurrent: () => true })).toBe('new')
  expect(ipc.save).toHaveBeenCalledWith(key, 'new')
  expect(controller.get(key)).toBe('new')
  expect(changed).toHaveBeenCalledTimes(1)
})

test('250 ms budget returns the previous image and ignores late results', async () => {
  vi.useFakeTimers()
  const ipc = transport(), capture = deferred<WorkspacePreviewCapture>(), compose = vi.fn(async () => 'late')
  ipc.capture.mockReturnValue(capture.promise)
  const controller = createWindowPreviewController(ipc, compose)
  await controller.load(key)
  const result = controller.capture({ ...key, element })
  await vi.advanceTimersByTimeAsync(250)
  expect(await result).toBe('previous')
  capture.resolve(snapshot)
  await vi.advanceTimersByTimeAsync(0)
  expect(compose).not.toHaveBeenCalled()
  expect(ipc.save).not.toHaveBeenCalled()
  expect(controller.get(key)).toBe('previous')
})

test('switching windows or geometry invalidates an outstanding capture', async () => {
  const ipc = transport(), capture = deferred<WorkspacePreviewCapture>()
  ipc.capture.mockReturnValue(capture.promise)
  const controller = createWindowPreviewController(ipc, async () => 'new')
  let current = true
  const pending = controller.capture({ ...key, element, isCurrent: () => current })
  current = false
  capture.resolve(snapshot)
  expect(await pending).toBeNull()
  expect(ipc.save).not.toHaveBeenCalled()
  current = true
  const changed = controller.capture({ ...key, element })
  element.getBoundingClientRect = () => ({ ...rect, width: 1200 }) as DOMRect
  expect(await changed).toBeNull()
  expect(ipc.save).not.toHaveBeenCalled()
})

test('deletion prevents a late cache read or capture from restoring a closed window', async () => {
  const ipc = transport(), read = deferred<string>(), capture = deferred<WorkspacePreviewCapture>()
  ipc.read.mockReturnValue(read.promise)
  ipc.capture.mockReturnValue(capture.promise)
  const controller = createWindowPreviewController(ipc, async () => 'new')
  const loading = controller.load(key), capturing = controller.capture({ ...key, element })
  await controller.remove(key)
  read.resolve('old')
  capture.resolve(snapshot)
  expect(await loading).toBeNull()
  expect(await capturing).toBeNull()
  expect(controller.get(key)).toBeNull()
  expect(ipc.save).not.toHaveBeenCalled()
  expect(ipc.remove).toHaveBeenCalledWith(key)
})

test('collects private toolbar and tab rectangles even outside the portaled workspace element', async () => {
  const privateTab = document.createElement('div'), privatePanel = document.createElement('div')
  privateTab.setAttribute('data-private-preview', '')
  privatePanel.className = 'browser-panel'
  privatePanel.dataset.private = 'true'
  privateTab.getBoundingClientRect = () => ({ x: 100, y: 44, width: 120, height: 32 }) as DOMRect
  privatePanel.getBoundingClientRect = () => ({ x: 100, y: 76, width: 400, height: 500 }) as DOMRect
  document.body.append(privateTab, privatePanel)
  const compose = vi.fn(async () => 'masked')
  await createWindowPreviewController(transport(), compose).capture({ ...key, element })
  expect(compose.mock.calls[0]![1]).toContainEqual({ x: 100, y: 44, width: 120, height: 32 })
  expect(compose.mock.calls[0]![1]).toContainEqual({ x: 100, y: 76, width: 400, height: 500 })
})

test('hidden retained windows never mask the currently visible public window', async () => {
  const hidden = document.createElement('div'), privatePanel = document.createElement('div')
  hidden.style.visibility = 'hidden'
  privatePanel.setAttribute('data-private-preview', '')
  privatePanel.getBoundingClientRect = () => rect as DOMRect
  hidden.append(privatePanel); document.body.append(hidden)
  const compose = vi.fn(async () => 'public')
  await createWindowPreviewController(transport(), compose).capture({ ...key, element })
  expect(compose.mock.calls[0]![1]).toEqual([])
})

test('slow disk writes do not expire a completed snapshot or hide it until restart', async () => {
  vi.useFakeTimers()
  const ipc = transport(), writing = deferred<undefined>()
  ipc.save.mockReturnValue(writing.promise)
  const controller = createWindowPreviewController(ipc, async () => 'new')
  expect(await controller.capture({ ...key, element })).toBe('new')
  await vi.advanceTimersByTimeAsync(300)
  expect(await controller.load(key)).toBe('new')
  writing.resolve(undefined)
})

test('composes public native views in host coordinates and masks private pixels last at 640 px', async () => {
  const drawn: string[] = [], context = { drawImage: vi.fn(() => drawn.push('image')), fillRect: vi.fn(() => drawn.push('mask')), fillStyle: '' }
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,masked')
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => tag === 'canvas' ? canvas : create(tag))
  vi.stubGlobal('Image', class { onload!: () => void; set src(_value: string) { queueMicrotask(() => this.onload()) } })
  const pageRect = { x: 600, y: 120, width: 500, height: 500 }
  const result = await composeWindowPreview({ ...snapshot, pages: [
    { rect: pageRect, imageDataUrl: 'public', isPrivate: false },
    { rect: { ...pageRect, x: 100 }, imageDataUrl: null, isPrivate: true }
  ] }, [{ x: 100, y: 44, width: 200, height: 32 }])
  expect(canvas.width).toBe(640)
  expect(canvas.height).toBe(448)
  expect(context.drawImage.mock.calls[1]!.slice(1)).toEqual([320, 48.64, 320, 320])
  expect(drawn).toEqual(['image', 'image', 'mask', 'mask'])
  expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
  expect(result).toBe('data:image/jpeg;base64,masked')
})
