import { useEffect, useState } from 'react'
import type { AnnotationBounds } from '../../../../shared/types/chatAnnotation'
import { invoke } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useBrowserGuests } from '../browser/browserGuestsStore'
import { getBrowserAnchorRect } from '../workspace/panels/browserAnchor'
import { beginAnnotationCapture, useAnnotationStore, type AnnotationCapture } from './annotationStore'
import { documentAnnotationAtPoint, targetStillCurrent, type DocumentAnnotationTarget } from './documentAdapters'
import { dragBounds, intersectBounds, normalizeBounds } from './geometry'
import './annotation.css'

const nextPaint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** Native browser highlights live in the guest; this overlay only paints app documents. */
export function AnnotationOverlay(): JSX.Element | null {
  const session = useAnnotationStore(state => state.session)
  const [highlight, setHighlight] = useState<{ rect: AnnotationBounds; region: boolean } | null>(null)
  useEffect(() => {
    if (!session) { setHighlight(null); return }
    let live = true, frame = 0, capturing = false, hover: DocumentAnnotationTarget | null = null
    let drag: { x: number; y: number; target: DocumentAnnotationTarget } | null = null
    const selection = window.getSelection()
    const savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
    const starts = new Map<string, AnnotationCapture>()
    const stopBrowser = (tabId: string, capture: AnnotationCapture): void => {
      void invoke('annotation:browserStop', { tabId, sessionId: session.id }).then(result => {
        for (const reference of result.references) capture.append(reference)
      }).catch(capture.fail).finally(capture.finish)
    }
    const fail = (error: unknown): void => { if (live) useAnnotationStore.setState({ error: error instanceof Error ? error.message : '선택한 부분을 추가하지 못했어요.' }) }
    const clear = (): void => { hover = null; drag = null; setHighlight(null) }
    const onMove = (event: PointerEvent): void => {
      if (capturing || frame) return
      const point = { x: event.clientX, y: event.clientY }
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!live || capturing) return
        if (drag) {
          const rect = intersectBounds(dragBounds(drag, point), drag.target.sourceRect)
          setHighlight(rect ? { rect, region: true } : null)
        } else {
          hover = documentAnnotationAtPoint(point, session.mode)
          setHighlight(hover ? { rect: hover.rect, region: hover.regionRequired } : null)
        }
      })
    }
    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0 || capturing) return
      const target = documentAnnotationAtPoint({ x: event.clientX, y: event.clientY }, session.mode)
      if (!target) return
      event.preventDefault(); event.stopImmediatePropagation()
      hover = target
      if (target.regionRequired) drag = { x: event.clientX, y: event.clientY, target }
    }
    const onUp = (event: PointerEvent): void => {
      if (event.button !== 0 || capturing) return
      const target = drag?.target ?? documentAnnotationAtPoint({ x: event.clientX, y: event.clientY }, session.mode)
      if (!target) return
      event.preventDefault(); event.stopImmediatePropagation()
      const region = drag ? intersectBounds(dragBounds(drag, { x: event.clientX, y: event.clientY }), target.sourceRect) : null
      if (target.regionRequired && (!region || region.width < 6 || region.height < 6)) {
        useAnnotationStore.setState({ error: '이 부분은 드래그해서 영역을 선택해 주세요.' }); clear(); return
      }
      const bounds = region ?? target.rect
      const visible = intersectBounds(bounds, target.panel.getBoundingClientRect())
      if (!visible) { clear(); return }
      const snapshotBounds = intersectBounds(visible, { x: 0, y: 0, width: innerWidth, height: innerHeight })
      if (!snapshotBounds) { clear(); return }
      const capture = beginAnnotationCapture(session)
      if (!capture) return
      const position = target.element.getBoundingClientRect()
      let quote = target.reference.quote
      if (region && target.reference.kind === 'pdf') {
        quote = [...target.panel.querySelectorAll<HTMLElement>(`[data-pdf-page="${target.reference.page}"] .textLayer span`)]
          .filter(element => intersectBounds(element.getBoundingClientRect(), snapshotBounds))
          .map(element => element.textContent ?? '').join(' ').trim().slice(0, 8000)
      } else if (region) quote = ''
      const reference = { ...target.reference, ...(quote ? { quote } : { quote: '' }), id: crypto.randomUUID(), capturedAt: new Date().toISOString(), rect: normalizeBounds(snapshotBounds, target.sourceRect) }
      // Preserve the clicked source immediately; pixels may arrive after the picker closes.
      capture.append(reference)
      capturing = true; clear(); useAnnotationStore.setState({ busy: true, error: null })
      void (async () => {
        await nextPaint()
        if (!targetStillCurrent(target)) throw new Error('선택한 원본은 보관했지만 화면이 바뀌어 이미지를 추가하지 못했어요.')
        const image = await invoke('annotation:captureHost', { rect: snapshotBounds })
        const currentPosition = target.element.getBoundingClientRect()
        if (!targetStillCurrent(target) || Math.abs(position.x - currentPosition.x) > 1 || Math.abs(position.y - currentPosition.y) > 1 || Math.abs(position.width - currentPosition.width) > 1 || Math.abs(position.height - currentPosition.height) > 1) throw new Error('선택한 원본은 보관했지만 위치가 바뀌어 이미지를 추가하지 못했어요.')
        capture.image(reference.id, image.imageDataUrl)
      })().catch(capture.fail).finally(() => { capture.finish(); capturing = false; if (live) useAnnotationStore.setState({ busy: false }) })
    }
    const onClick = (event: MouseEvent): void => {
      if (documentAnnotationAtPoint({ x: event.clientX, y: event.clientY }, session.mode)) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopImmediatePropagation(); useAnnotationStore.getState().stop()
    }
    const unsubscribe = useWorkspaceStore.subscribe(state => { if ((state.activeWindowKey ?? state.activeWorkspaceKey) !== session.workspaceKey || state.surface !== 'course' || state.windowsOverviewOpen) useAnnotationStore.getState().stop() })
    let draining = false
    const pollBrowsers = async (): Promise<void> => {
      if (!live || draining) return
      draining = true
      try {
        const workspace = useWorkspaceStore.getState()
        const visible = useBrowserGuests.getState().liveGuests.filter(guest => getBrowserAnchorRect(guest.tabId))
        for (const [tabId, capture] of starts) if (!visible.some(guest => guest.tabId === tabId)) { starts.delete(tabId); stopBrowser(tabId, capture) }
        await Promise.all(visible.map(async guest => {
          const source = Object.entries(workspace.openTabs).find(([, descriptor]) => descriptor.kind === 'browser' && descriptor.payload.tabId === guest.tabId)
          if (!source || !guest.courseId) return
          try {
            if (!starts.has(guest.tabId)) {
              const capture = beginAnnotationCapture(session)
              if (!capture) return
              starts.set(guest.tabId, capture)
              await invoke('annotation:browserStart', { tabId: guest.tabId, sessionId: session.id, mode: session.mode, courseId: guest.courseId, sourcePanelId: source[0] })
              if (!live) { stopBrowser(guest.tabId, capture); return }
            }
            const capture = starts.get(guest.tabId)
            if (!capture) return
            const result = await invoke('annotation:browserDrain', { tabId: guest.tabId, sessionId: session.id })
            for (const reference of result.references) capture.append(reference)
            if (live && result.cancelled) useAnnotationStore.getState().stop()
          } catch (error) {
            const capture = starts.get(guest.tabId)
            starts.delete(guest.tabId)
            if (capture) { capture.fail(error); stopBrowser(guest.tabId, capture) }
            else if (getBrowserAnchorRect(guest.tabId)) fail(error)
          }
        }))
      } finally { draining = false }
    }
    const timer = window.setInterval(() => void pollBrowsers(), 180)
    void pollBrowsers()
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('dblclick', onClick, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    return () => {
      live = false; clear(); cancelAnimationFrame(frame); clearInterval(timer); unsubscribe()
      for (const [tabId, capture] of starts) stopBrowser(tabId, capture)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onClick, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
      try { const current = window.getSelection(); current?.removeAllRanges(); for (const range of savedRanges) if (range.startContainer.isConnected) current?.addRange(range) } catch { /* The source can close during a selection. */ }
    }
  }, [session])
  if (!session || !highlight) return null
  return <div className="annotation-highlight" aria-hidden="true" data-annotation-ui style={{ left: highlight.rect.x, top: highlight.rect.y, width: highlight.rect.width, height: highlight.rect.height }}>
    <span>{highlight.region ? '드래그해서 영역 선택' : '클릭해서 AI에 추가'}</span>
  </div>
}
