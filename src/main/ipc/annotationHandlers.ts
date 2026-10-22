import { randomUUID } from 'node:crypto'
import { BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { AnnotationIpcContract } from '../../shared/ipc/annotationContract'
import type { AnnotationBounds, AnnotationMode, AnnotationReference } from '../../shared/types/chatAnnotation'
import { sanitizeAnnotationReferences } from '../../shared/types/chatAnnotation'
import { annotationBrowserTarget } from '../features/browser/nativeTabs'
import { browserAuthDocumentId } from '../features/browser/embeddedAuth'
import { isCleanBrowserAuthProbe } from '../features/browser/authProbe'
import { browserAnnotationPickerSource } from '../features/browser/annotationPickerSource'
import { boundedCaptureRect, captureAnnotationImage } from '../features/browser/annotationCapture'

type Handler = <K extends keyof AnnotationIpcContract>(channel: K, fn: (input: AnnotationIpcContract[K]['req'], event: IpcMainInvokeEvent) => AnnotationIpcContract[K]['res'] | Promise<AnnotationIpcContract[K]['res']>) => void
const WORLD_ID = 1947
const PICKER_KEY = '__bandalAnnotationPickerV1'
interface Session { id: string; epoch: string; url: string; documentId: string; ownerId: number; courseId: string; sourcePanelId: string; mode: AnnotationMode; draining?: Promise<DrainResult>; finishing?: Promise<DrainResult> }
type DrainResult = AnnotationIpcContract['annotation:browserDrain']['res']
interface Pick { cancelled?: boolean; pickId: number; rect: AnnotationBounds; quote: string; selector: string; title: string; url: string; scrollX: number; scrollY: number; viewport: { width: number; height: number } }
interface Drain { events: Pick[]; url: string; scrollX: number; scrollY: number; viewport: { width: number; height: number } }
const sessions = new Map<number, Session>()
const isolated = <T>(contents: WebContents, code: string): Promise<T> => contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }]) as Promise<T>
const command = (session: string, action: string): string => `(() => {const p=globalThis[${JSON.stringify(PICKER_KEY)}];return p&&p.sessionId===${JSON.stringify(session)}?p.${action}:null})()`

export function registerAnnotationHandlers(handle: Handler): void {
  const drain = (contents: WebContents, session: Session, tabId: string, visible: () => boolean): Promise<DrainResult> => {
    if (session.draining) return session.draining
    const current = (): boolean => !contents.isDestroyed() && sessions.get(contents.id) === session && session.documentId === browserAuthDocumentId(contents) && session.url === contents.getURL()
    const canCapture = (): boolean => { try { return current() && visible() } catch { return false } }
    const operation = (async (): Promise<DrainResult> => {
      if (!current()) return { references: [], cancelled: true }
      const drained = await isolated<Drain | null>(contents, command(session.id, 'drain()'))
      if (!drained) return { references: [], cancelled: true }
      const references: AnnotationReference[] = []
      let cancelled = false
      try {
        for (const pick of drained.events.slice(0, 20)) {
          if (pick.cancelled) { cancelled = true; continue }
          if (!pick.rect || !Number.isSafeInteger(pick.pickId)) continue
          const rect = boundedCaptureRect(pick.rect, pick.viewport)
          const [reference] = sanitizeAnnotationReferences([{ id: randomUUID(), kind: session.mode === 'region' ? 'region' : 'browser', courseId: session.courseId, sourcePanelId: session.sourcePanelId, browserTabId: tabId,
            title: pick.title || pick.url, url: pick.url, quote: pick.quote, selector: pick.selector, rect: { x: rect.x / pick.viewport.width, y: rect.y / pick.viewport.height, width: rect.width / pick.viewport.width, height: rect.height / pick.viewport.height }, capturedAt: new Date().toISOString(), documentEpoch: session.epoch }])
          if (!reference) continue
          // The user's click already selected this snapshot. Losing visibility or
          // ending the picker may prevent pixels, but must not discard its quote.
          references.push(reference)
          if (!canCapture() || pick.url !== drained.url || pick.scrollX !== drained.scrollX || pick.scrollY !== drained.scrollY || pick.viewport.width !== drained.viewport.width || pick.viewport.height !== drained.viewport.height) continue
          if (!await isolated<boolean>(contents, command(session.id, `valid(${pick.pickId})`)).catch(() => false)) continue
          try {
            const imageDataUrl = await captureAnnotationImage(contents, boundedCaptureRect(rect, pick.viewport, contents.getZoomFactor()))
            const still = await isolated<{ url: string; x: number; y: number; width: number; height: number }>(contents, '({url:location.href,x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})')
            if (canCapture() && still.url === pick.url && still.x === pick.scrollX && still.y === pick.scrollY && still.width === pick.viewport.width && still.height === pick.viewport.height && await isolated<boolean>(contents, command(session.id, `valid(${pick.pickId})`))) reference.imageDataUrl = imageDataUrl
          } catch { /* Keep the accepted textual/location snapshot if capture becomes unavailable. */ }
        }
      } finally { if (!contents.isDestroyed()) await isolated(contents, command(session.id, 'resume()')).catch(() => undefined) }
      return { references, cancelled }
    })()
    session.draining = operation
    void operation.finally(() => { if (session.draining === operation) delete session.draining }).catch(() => undefined)
    return operation
  }
  const finish = (contents: WebContents, session: Session, tabId: string, visible: () => boolean): Promise<DrainResult> => {
    if (session.finishing) return session.finishing
    const inFlight = session.draining
    const operation = (async (): Promise<DrainResult> => {
      try {
        // Freeze new input immediately, retaining queued picks and their DOM
        // validation records until both the current and final drain have settled.
        await isolated(contents, command(session.id, 'stop(false)')).catch(() => undefined)
        const previous = await inFlight
        const remaining = await drain(contents, session, tabId, visible)
        return { references: [...(previous?.references ?? []), ...remaining.references], cancelled: true }
      } finally {
        if (sessions.get(contents.id) === session) sessions.delete(contents.id)
        if (!contents.isDestroyed()) await isolated(contents, command(session.id, 'stop()')).catch(() => undefined)
      }
    })()
    session.finishing = operation
    return operation
  }
  handle('annotation:browserStart', async (req, event) => {
    if (isCleanBrowserAuthProbe()) throw new Error('로그인 진단 화면에서는 부분 선택을 사용할 수 없어요.')
    if (!req.sessionId || !req.sourcePanelId || !['element', 'region'].includes(req.mode)) throw new Error('선택 모드를 확인할 수 없어요.')
    const target = annotationBrowserTarget(event, req.tabId)
    if (!target.visible || target.courseId !== req.courseId) throw new Error('현재 공간의 열린 브라우저에서 선택해 주세요.')
    const { contents } = target
    const previous = sessions.get(contents.id)
    if (previous) await finish(contents, previous, req.tabId, () => target.visible)
    const session: Session = { id: req.sessionId, epoch: randomUUID(), url: contents.getURL(), documentId: browserAuthDocumentId(contents), ownerId: event.sender.id, courseId: req.courseId, sourcePanelId: req.sourcePanelId, mode: req.mode }
    if (!sessions.has(contents.id)) contents.once('destroyed', () => sessions.delete(contents.id))
    sessions.set(contents.id, session)
    try {
      await isolated(contents, browserAnnotationPickerSource({ sessionId: req.sessionId, mode: req.mode }))
      if (contents.isDestroyed() || sessions.get(contents.id) !== session || session.documentId !== browserAuthDocumentId(contents) || session.url !== contents.getURL()) throw new Error('페이지가 바뀌었어요. 다시 선택해 주세요.')
    } catch (error) {
      if (sessions.get(contents.id) === session) sessions.delete(contents.id)
      throw error
    }
    return { epoch: session.epoch }
  })
  handle('annotation:browserStop', async (req, event) => {
    const target = annotationBrowserTarget(event, req.tabId), { contents } = target
    const session = sessions.get(contents.id)
    if (session?.id !== req.sessionId || session.ownerId !== event.sender.id) return { ok: true, references: [] }
    const result = await finish(contents, session, req.tabId, () => annotationBrowserTarget(event, req.tabId).visible)
    return { ok: true, references: result.references }
  })
  handle('annotation:browserDrain', async (req, event) => {
    const target = annotationBrowserTarget(event, req.tabId), { contents } = target
    const session = sessions.get(contents.id)
    if (!session || session.id !== req.sessionId || session.ownerId !== event.sender.id) return { references: [], cancelled: true }
    if (session.finishing) return session.finishing
    return drain(contents, session, req.tabId, () => annotationBrowserTarget(event, req.tabId).visible)
  })
  handle('annotation:captureHost', async (req, event) => {
    const host = BrowserWindow.fromWebContents(event.sender)
    if (!host || host.isDestroyed()) throw new Error('열린 작업 공간을 찾을 수 없어요.')
    const [width = 0, height = 0] = host.getContentSize(), scale = event.sender.getZoomFactor()
    return { imageDataUrl: await captureAnnotationImage(event.sender, boundedCaptureRect(req.rect, { width: width / scale, height: height / scale }, scale)) }
  })
  handle('annotation:browserReveal', async (req, event) => {
    const { contents } = annotationBrowserTarget(event, req.tabId)
    if (contents.getURL() !== req.url || isCleanBrowserAuthProbe()) return { found: false }
    const found = await isolated<boolean>(contents, `(() => {let target=null;try{target=${JSON.stringify(req.selector ?? '')}?document.querySelector(${JSON.stringify(req.selector ?? '')}):null}catch{} const quote=${JSON.stringify((req.quote ?? '').slice(0, 8000))};if(target&&quote&&!(target.innerText||target.textContent||'').includes(quote))target=null;if(!target&&quote)target=Array.from(document.querySelectorAll('p,li,h1,h2,h3,td,th,blockquote,pre')).slice(0,5000).find(el=>(el.innerText||el.textContent||'').includes(quote));if(!target)return false;target.scrollIntoView({block:'center',behavior:'smooth'});return true})()`)
    return { found }
  })
}
