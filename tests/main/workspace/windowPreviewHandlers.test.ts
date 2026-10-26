import { beforeEach, expect, test, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ handlers: {} as Record<string, (...args: any[]) => any>, host: null as any,
  targets: [] as any[], capture: vi.fn(async () => 'data:image/jpeg;base64,host'),
  cache: { read: vi.fn(), save: vi.fn(), remove: vi.fn() } }))
vi.mock('electron', () => ({ app: { getPath: () => '/profile' }, BrowserWindow: { fromWebContents: () => fixture.host },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 640, height: 360 }) }) } }))
vi.mock('../../../src/main/features/browser/annotationCapture', () => ({
  boundedCaptureRect: (rect: any, _viewport: any, scale: number) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Number(value) * scale])),
  captureAnnotationImage: fixture.capture
}))
vi.mock('../../../src/main/features/browser/nativeTabs', () => ({ workspaceBrowserPreviewTargets: () => fixture.targets }))
vi.mock('../../../src/main/features/workspace/windowPreviewCache', () => ({ createWindowPreviewCache: () => fixture.cache, previewImageBytes: () => Buffer.from('jpeg') }))
import { registerWorkspacePreviewHandlers } from '../../../src/main/ipc/workspacePreviewHandlers'
const sender = { mainFrame: {}, getZoomFactor: () => 2, isDestroyed: () => false }, rect = { x: 10, y: 20, width: 400, height: 300 }
const event = { sender, senderFrame: sender.mainFrame }
beforeEach(() => {
  vi.clearAllMocks()
  fixture.targets = []
  fixture.host = { isDestroyed: () => false, getContentSize: () => [1000, 800] }
  registerWorkspacePreviewHandlers((channel, handler) => { fixture.handlers[channel] = handler })
})

test('uses main bounds, excludes nonintersecting pages, never captures private contents', async () => {
  const publicPage = {}, privatePage = {}, outside = {}
  fixture.targets = [
    { contents: publicPage, bounds: { x: 40, y: 80, width: 320, height: 200 }, isPrivate: false, isCurrent: () => true },
    { contents: privatePage, bounds: { x: 400, y: 80, width: 320, height: 200 }, isPrivate: true, isCurrent: () => true },
    { contents: outside, bounds: { x: 900, y: 80, width: 10, height: 20 }, isPrivate: false, isCurrent: () => true }
  ]
  const result = await fixture.handlers['workspacePreview:capture']!({ rect }, event)
  expect(result.rect).toEqual(rect)
  expect(result.pages).toEqual([
    { rect: { x: 20, y: 40, width: 160, height: 100 }, imageDataUrl: expect.any(String), isPrivate: false },
    { rect: { x: 200, y: 40, width: 160, height: 100 }, imageDataUrl: null, isPrivate: true }
  ])
  expect(fixture.capture.mock.calls.map(call => call[0])).toEqual([sender, publicPage])
})

test('rejects a page switched or moved during capture instead of caching mixed windows', async () => {
  fixture.targets = [{ contents: {}, bounds: { x: 40, y: 80, width: 320, height: 200 }, isPrivate: false, isCurrent: () => false }]
  await expect(fixture.handlers['workspacePreview:capture']!({ rect }, event)).rejects.toThrow('Workspace changed')
})

test('capture rejects subframe or missing host', async () => {
  await expect(fixture.handlers['workspacePreview:capture']!({ rect }, { ...event, senderFrame: {} })).rejects.toThrow('Invalid workspace preview host')
  fixture.host = null
  await expect(fixture.handlers['workspacePreview:capture']!({ rect }, event)).rejects.toThrow('Invalid workspace preview host')
})
