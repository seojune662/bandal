import { beforeEach, expect, test, vi } from 'vitest'
import type { AnnotationIpcContract } from '../../../src/shared/ipc/annotationContract'

const fixture = vi.hoisted(() => ({ url: 'https://example.test/a', document: 'document-a', visible: true, owner: 'course-1', captured: vi.fn(), script: vi.fn(), onDestroy: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false, getContentSize: () => [1000, 700] }) } }))
vi.mock('../../../src/main/features/browser/nativeTabs', () => ({ annotationBrowserTarget: (_event: unknown, tabId: string) => {
  if (tabId !== 'tab-1') throw new Error('Browser tab closed')
  return { contents: { id: 123, once: fixture.onDestroy, isDestroyed: () => false, getURL: () => fixture.url, getZoomFactor: () => 1.5, executeJavaScriptInIsolatedWorld: fixture.script }, visible: fixture.visible, courseId: fixture.owner }
} }))
vi.mock('../../../src/main/features/browser/embeddedAuth', () => ({ browserAuthDocumentId: () => fixture.document }))
vi.mock('../../../src/main/features/browser/authProbe', () => ({ isCleanBrowserAuthProbe: () => false }))
vi.mock('../../../src/main/features/browser/annotationCapture', async () => ({ ...await vi.importActual('../../../src/main/features/browser/annotationCapture'), captureAnnotationImage: fixture.captured }))

const request = { tabId: 'tab-1', sessionId: 'selection-1', mode: 'element' as const, courseId: 'course-1', sourcePanelId: 'browser:one' }
const event = { sender: { id: 77, getZoomFactor: () => 1 }, senderFrame: {} } as Electron.IpcMainInvokeEvent
const pick = { pickId: 1, rect: { x: 20, y: 40, width: 200, height: 100 }, quote: 'Visible original paragraph', selector: '#paragraph', title: 'Example', url: 'https://example.test/a', scrollX: 0, scrollY: 0, viewport: { width: 800, height: 600 } }
const callbacks = new Map<string, (input: any, event: Electron.IpcMainInvokeEvent) => any>()
const invoke = async <K extends keyof AnnotationIpcContract>(channel: K, req: AnnotationIpcContract[K]['req']): Promise<AnnotationIpcContract[K]['res']> => callbacks.get(channel)!(req, event)

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); callbacks.clear()
  fixture.url = 'https://example.test/a'; fixture.document = 'document-a'; fixture.owner = 'course-1'; fixture.visible = true
  fixture.captured.mockResolvedValue('data:image/jpeg;base64,YQ==')
  fixture.script.mockImplementation(async (_world, scripts) => {
    const code: string = scripts[0].code
    if (code.includes('p.drain()')) return { events: [pick], url: fixture.url, scrollX: 0, scrollY: 0, viewport: pick.viewport }
    if (code.includes('({url:location.href,x:scrollX')) return { url: fixture.url, x: 0, y: 0, width: 800, height: 600 }
    if (code.includes('p.valid(')) return true
    return null
  })
  const { registerAnnotationHandlers } = await import('../../../src/main/ipc/annotationHandlers')
  registerAnnotationHandlers((channel, callback) => { callbacks.set(channel, callback) })
})

test('captures a committed native selection in page DIP with fixed source identity', async () => {
  await invoke('annotation:browserStart', request)
  const result = await invoke('annotation:browserDrain', request)
  expect(fixture.script).toHaveBeenCalledWith(1947, expect.any(Array))
  expect(fixture.captured).toHaveBeenCalledWith(expect.anything(), { x: 30, y: 60, width: 300, height: 150 })
  expect(result.references[0]).toMatchObject({ courseId: 'course-1', sourcePanelId: 'browser:one', browserTabId: 'tab-1', quote: pick.quote, url: pick.url, rect: { x: .025, y: 40 / 600, width: .25, height: 100 / 600 } })
})

test('refuses another resource owner or a hidden page before installing a picker', async () => {
  await expect(invoke('annotation:browserStart', { ...request, courseId: 'other-course' })).rejects.toThrow()
  fixture.visible = false
  await expect(invoke('annotation:browserStart', request)).rejects.toThrow()
  expect(fixture.script).not.toHaveBeenCalled()
})

test('navigation invalidates the selection epoch before any screenshot is captured', async () => {
  await invoke('annotation:browserStart', request)
  fixture.document = 'document-b'
  expect(await invoke('annotation:browserDrain', request)).toEqual({ references: [], cancelled: true })
  expect(fixture.captured).not.toHaveBeenCalled()
})

test('a scroll between click and drain does not pair old text with a new screenshot', async () => {
  await invoke('annotation:browserStart', request)
  fixture.script.mockResolvedValueOnce({ events: [pick], url: fixture.url, scrollX: 0, scrollY: 200, viewport: pick.viewport })
  expect((await invoke('annotation:browserDrain', request)).references).toEqual([])
  expect(fixture.captured).not.toHaveBeenCalled()
})

test('navigation during capture discards the completed image', async () => {
  await invoke('annotation:browserStart', request)
  fixture.captured.mockImplementationOnce(async () => { fixture.document = 'document-b'; return 'data:image/jpeg;base64,YQ==' })
  expect((await invoke('annotation:browserDrain', request)).references).toEqual([])
})

test('a same-page source edit before capture cannot pair old text with a changed image', async () => {
  await invoke('annotation:browserStart', request)
  const baseline = fixture.script.getMockImplementation()!
  fixture.script.mockImplementation(async (world, scripts) => scripts[0].code.includes('p.valid(') ? false : baseline(world, scripts))
  expect((await invoke('annotation:browserDrain', request)).references).toEqual([])
  expect(fixture.captured).not.toHaveBeenCalled()
})
