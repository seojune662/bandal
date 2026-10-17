import './pdfPreview.css'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { deletePage, duplicatePage, insertBlankPage, movePage, moveTarget, rotatePage, type PageRecipeEntry } from './pageRecipe'

export interface PdfRestructureResult { documentRevision: string; fingerprint: string; pageCount: number; pageMap: number[][] }
interface Props {
  pdf: PDFDocumentProxy | null; numPages: number; currentPage: number; onJump(page: number): void
  courseId: string; relPath: string; revision: string | null
  suspend(): Promise<void>; resume(): void; onRestructured(result: PdfRestructureResult): void
}
/** Lazy pdf.js thumbnails for the rows in view (the desktop panel's helpers are not exported). */
function useVisibleThumbnails(listRef: React.RefObject<HTMLElement>) {
  const [visiblePages, setVisible] = useState<Set<number>>(() => new Set())
  const observer = useRef<IntersectionObserver | null>(null)
  useEffect(() => {
    observer.current = new IntersectionObserver(entries => setVisible(previous => {
      const next = new Set(previous)
      for (const entry of entries) { const page = Number((entry.target as HTMLElement).dataset.page); if (entry.isIntersecting) next.add(page); else next.delete(page) }
      return next
    }), { root: listRef.current, rootMargin: '50% 0px 50% 0px' })
    // Refs ran before this effect: observe the rows already in the list.
    listRef.current?.querySelectorAll<HTMLElement>('[data-pdf-pages-item] > .pdf-preview__item').forEach(node => observer.current?.observe(node))
    return () => observer.current?.disconnect()
  }, [listRef])
  const register = (page: number) => (node: HTMLElement | null) => { if (node) { node.dataset.page = String(page); observer.current?.observe(node) } }
  return { visiblePages, register }
}
function PdfThumbnail({ pdf, pageNumber, visible }: { pdf: PDFDocumentProxy | null; pageNumber: number; visible: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!visible || !pdf) return
    let active = true
    void pdf.getPage(pageNumber).then(async page => {
      const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: 160 / base.width })
      const canvas = canvasRef.current
      if (!active || !canvas) return
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return
      await page.render({ canvas, canvasContext: context, viewport } as Parameters<typeof page.render>[0]).promise
      if (active) canvas.dataset['ready'] = 'true'
    }).catch(() => undefined)
    return () => { active = false }
  }, [pdf, pageNumber, visible])
  return <canvas ref={canvasRef} className="pdf-preview__canvas" aria-hidden="true" />
}
type Drag = { pointerId: number; page: number; startX: number; startY: number; active: boolean; slot: number | null; timer: number | undefined }
const HOLD_MS = 250, SLOP = 8
const request = (channel: string, payload: Record<string, unknown>): Promise<unknown> =>
  (window as unknown as { bandal: { invoke(channel: string, payload: unknown): Promise<unknown> } }).bandal.invoke(channel, payload)

/** Page thumbnails that also edit the document: tap to jump, hold and drag to
 * reorder, a per-page menu for delete / rotate / duplicate / blank pages.
 * Every edit is one `pdf:restructure` recipe; the viewer remounts afterwards. */
export function PdfPagesPanel({ pdf, numPages, currentPage, onJump, courseId, relPath, revision, suspend, resume, onRestructured }: Props): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const { visiblePages, register } = useVisibleThumbnails(listRef)
  const [menu, setMenu] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState<{ page: number; slot: number | null } | null>(null)
  const gesture = useRef<Drag | null>(null)
  useEffect(() => { listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }) }, [currentPage])
  useEffect(() => { setMenu(null); setConfirmDelete(null) }, [numPages, revision])

  const run = async (pages: PageRecipeEntry[]): Promise<void> => {
    if (busy || !revision) return
    setBusy(true); setError(''); setMenu(null); setConfirmDelete(null)
    try {
      await suspend()
      const result = await request('pdf:restructure', { courseId, relPath, expectedRevision: revision, pages }) as PdfRestructureResult
      onRestructured(result)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      resume()
    } finally { setBusy(false) }
  }
  // ponytail: hold-to-drag with no edge autoscroll; add autoscroll if long documents need it.
  /** Insert slot under the pointer: 1..n = before that page, n + 1 = after the last. */
  const slotAt = (clientY: number): number | null => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-pdf-pages-item]') ?? [])]
    for (const [index, item] of items.entries()) { const rect = item.getBoundingClientRect(); if (clientY < rect.top + rect.height / 2) return index + 1 }
    return items.length ? items.length + 1 : null
  }
  const endDrag = () => {
    const active = gesture.current
    gesture.current = null
    if (active?.timer) window.clearTimeout(active.timer)
    setDrag(null)
    return active
  }
  const down = (page: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (busy || event.button !== 0 || gesture.current) return
    // Every pointer type holds first: a Pencil tap must never reorder pages.
    const start = () => { if (gesture.current) { gesture.current.active = true; setDrag({ page, slot: null }) } }
    gesture.current = { pointerId: event.pointerId, page, startX: event.clientX, startY: event.clientY, active: false, slot: null, timer: window.setTimeout(start, HOLD_MS) }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* synthetic */ }
  }
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    if (!active.active) {
      // Scrolling before the hold completes is a scroll, not a drag.
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > SLOP) endDrag()
      return
    }
    event.preventDefault()
    const slot = slotAt(event.clientY)
    if (slot !== active.slot) { active.slot = slot; setDrag({ page: active.page, slot }) }
  }
  const up = (event: ReactPointerEvent<HTMLElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const finished = endDrag()!
    if (!finished.active) return
    event.preventDefault()
    if (Math.hypot(event.clientX - finished.startX, event.clientY - finished.startY) < SLOP) return
    const target = finished.slot === null ? null : moveTarget(numPages, finished.page, finished.slot)
    if (target !== null) void run(movePage(numPages, finished.page, target))
  }
  const dropMarker = (page: number): string | undefined => {
    if (!drag || drag.slot === null || moveTarget(numPages, drag.page, drag.slot) === null) return undefined
    if (drag.slot === page) return 'before'
    return drag.slot === numPages + 1 && page === numPages ? 'after' : undefined
  }
  const menuItem = (label: string, recipe: () => PageRecipeEntry[]) => <button type="button" role="menuitem" onClick={() => void run(recipe())}>{label}</button>
  return <aside className="pdf-preview pdf-pages" aria-label="페이지" data-busy={busy}>
    <div className="pdf-preview__header"><strong>페이지</strong><span>{numPages}쪽</span></div>
    {error && <p className="pdf-pages__error" role="alert">{error}</p>}
    <div ref={listRef} className="pdf-preview__list">
      {Array.from({ length: numPages }, (_, index) => index + 1).map(page => <div key={page} className="pdf-pages__item" data-pdf-pages-item
        data-dragging={drag?.page === page || undefined} data-drop={dropMarker(page)}>
        <button ref={register(page)} type="button" className="pdf-preview__item" aria-label={`${page}쪽으로 이동`} aria-current={page === currentPage ? 'page' : undefined}
          onClick={() => { if (!gesture.current?.active) onJump(page) }} onPointerDown={down(page)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => endDrag()}>
          <span className="pdf-preview__paper"><PdfThumbnail pdf={pdf} pageNumber={page} visible={visiblePages.has(page)} /></span>
          <span className="pdf-preview__page-number">{page}</span>
        </button>
        <button type="button" className="pdf-pages__more" aria-label={`${page}쪽 메뉴`} aria-haspopup="menu" aria-expanded={menu === page} disabled={busy}
          onClick={() => { setConfirmDelete(null); setMenu(menu === page ? null : page) }}>···</button>
        {menu === page && <div className="pdf-pages__menu" role="menu" aria-label={`${page}쪽 메뉴`}>
          {menuItem('앞에 빈 페이지', () => insertBlankPage(numPages, page))}
          {menuItem('뒤에 빈 페이지', () => insertBlankPage(numPages, page + 1))}
          {menuItem('복제', () => duplicatePage(numPages, page))}
          {menuItem('오른쪽으로 회전', () => rotatePage(numPages, page, 90))}
          {confirmDelete === page
            ? <button type="button" role="menuitem" className="pdf-pages__danger" onClick={() => void run(deletePage(numPages, page))} disabled={numPages < 2}>{numPages < 2 ? '마지막 페이지는 삭제할 수 없어요' : '삭제 확인 · 이 페이지의 필기도 숨겨져요'}</button>
            : <button type="button" role="menuitem" className="pdf-pages__danger" onClick={() => setConfirmDelete(page)} disabled={numPages < 2}>삭제</button>}
        </div>}
      </div>)}
      <button type="button" className="pdf-pages__add" disabled={busy || !revision} onClick={() => void run(insertBlankPage(numPages, numPages + 1))}>+ 페이지 추가</button>
    </div>
  </aside>
}
