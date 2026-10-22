import { beforeEach, expect, test, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ handlers: {} as Record<string, (req: any, event: any) => Promise<any>>, visible: true, events: [] as any[], calls: [] as string[], capture: vi.fn(), contents: {} as any }))
vi.mock('electron', () => ({ BrowserWindow: {} }))
vi.mock('../../../src/main/features/browser/nativeTabs', () => ({ annotationBrowserTarget: () => ({ contents: fixture.contents, visible: fixture.visible, courseId: 'owner' }) }))
vi.mock('../../../src/main/features/browser/embeddedAuth', () => ({ browserAuthDocumentId: () => 'document-1' }))
vi.mock('../../../src/main/features/browser/authProbe', () => ({ isCleanBrowserAuthProbe: () => false }))
vi.mock('../../../src/main/features/browser/annotationCapture', () => ({ boundedCaptureRect: (rect: any) => rect, captureAnnotationImage: fixture.capture }))
import { registerAnnotationHandlers } from '../../../src/main/ipc/annotationHandlers'
const viewport = { width: 800, height: 600 }, url = 'https://example.com/source', event = { sender: { id: 10 } }
let contentsId = 50
const pick = () => ({ pickId: 1, quote: 'Clicked original text', selector: '#source', title: 'Original', url, scrollX: 0, scrollY: 0, viewport, rect: { x: 10, y: 20, width: 200, height: 40 } })
const start = () => fixture.handlers['annotation:browserStart']!({ tabId: 'tab', sessionId: 'picker', mode: 'element', courseId: 'owner', sourcePanelId: 'panel' }, event)
const drain = () => fixture.handlers['annotation:browserDrain']!({ tabId: 'tab', sessionId: 'picker' }, event)
const stop = () => fixture.handlers['annotation:browserStop']!({ tabId: 'tab', sessionId: 'picker' }, event)
beforeEach(() => {
  fixture.calls = []; fixture.events = []; fixture.visible = true; fixture.capture.mockReset().mockResolvedValue('data:image/png;base64,AAAA')
  fixture.contents = { id: ++contentsId, once: vi.fn(), isDestroyed: () => false, getURL: () => url, getZoomFactor: () => 1,
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world, [{ code }]) => {
      fixture.calls.push(code)
      if (code.includes('?p.drain()')) return { events: fixture.events.splice(0), url, scrollX: 0, scrollY: 0, viewport }
      if (code.includes('?p.valid(')) return true
      if (code.startsWith('({url:location.href')) return { url, x: 0, y: 0, ...viewport }
      return null
    }) }
  registerAnnotationHandlers((channel, handler) => { fixture.handlers[channel] = handler as any })
})

test('Finish freezes input, waits for an in-flight native capture and returns its reference before disposing the picker', async () => {
  await start(); fixture.events.push(pick())
  let finishImage!: (image: string) => void
  fixture.capture.mockImplementationOnce(() => new Promise(resolve => { finishImage = resolve }))
  const polling = drain(); await vi.waitFor(() => expect(fixture.capture).toHaveBeenCalledOnce())
  const finishing = stop(); await vi.waitFor(() => expect(fixture.calls.some(code => code.includes('?p.stop(false)'))).toBe(true))
  expect(fixture.calls.some(code => code.includes('?p.stop()'))).toBe(false)
  finishImage('data:image/png;base64,AAAA')
  const [polled, finished] = await Promise.all([polling, finishing])
  expect(polled.references).toHaveLength(1); expect(finished.references).toHaveLength(1)
  expect(finished.references[0]).toMatchObject({ id: polled.references[0].id, quote: 'Clicked original text', courseId: 'owner', sourcePanelId: 'panel', imageDataUrl: 'data:image/png;base64,AAAA' })
  expect(fixture.calls.some(code => code.includes('?p.stop()'))).toBe(true)
  expect(await drain()).toEqual({ references: [], cancelled: true })
})

test('Finish drains the last click before the periodic poll, including an immediately queued Escape', async () => {
  await start(); fixture.events.push(pick(), { cancelled: true })
  const finished = await stop()
  expect(finished.references).toEqual([expect.objectContaining({ quote: 'Clicked original text', imageDataUrl: 'data:image/png;base64,AAAA' })])
  expect(await stop()).toEqual({ ok: true, references: [] })
})

test('switching spaces keeps the original clicked source but never captures a hidden/new screen', async () => {
  await start(); fixture.events.push(pick()); fixture.visible = false
  const finished = await stop()
  expect(finished.references).toEqual([expect.objectContaining({ quote: 'Clicked original text', courseId: 'owner', sourcePanelId: 'panel' })])
  expect(finished.references[0].imageDataUrl).toBeUndefined(); expect(fixture.capture).not.toHaveBeenCalled()
})


test('navigation while checking a picked element retains its accepted quote when isolated-world validation rejects', async () => {
  await start(); fixture.events.push(pick())
  const original = fixture.contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!
  fixture.contents.executeJavaScriptInIsolatedWorld.mockImplementation((world: number, scripts: any[]) => scripts[0].code.includes('?p.valid(') ? Promise.reject(new Error('Document navigated')) : original(world, scripts))
  const result = await stop()
  expect(result.references).toEqual([expect.objectContaining({ quote: 'Clicked original text' })])
  expect(result.references[0].imageDataUrl).toBeUndefined()
})
