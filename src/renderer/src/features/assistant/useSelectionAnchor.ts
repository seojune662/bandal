import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BROWSER_SELECTION_EVENT,
  type BrowserSelectionDetail
} from '../browser/selectionBridge'
import { readPageSelection, textLayerText } from '../pdf/lib/domSelection'

const SELECTION_DEBOUNCE_MS = 120

export interface SelectionAnchorRect {
  left: number
  top: number
  width: number
  height: number
}

export interface AnchoredSelection {
  id: number
  text: string
  rect: SelectionAnchorRect
  source: string
  kind: 'renderer' | 'browser'
}

function elementForNode(node: Node | null): Element | null {
  if (node instanceof Element) return node
  return node?.parentElement ?? null
}

function activeTabTitle(origin: Element | null): string | null {
  const group = origin?.closest('.dv-groupview')
  const localTitle = group?.querySelector<HTMLElement>(
    '.dv-active-tab .workspace-tab__title'
  )
  const globalTitle = document.querySelector<HTMLElement>(
    '.dv-active-group .dv-active-tab .workspace-tab__title'
  )
  const title = (localTitle ?? globalTitle)?.textContent?.trim()
  return title === undefined || title === '' ? null : title
}

function rendererSource(origin: Element | null, page: number | null): string {
  const title = activeTabTitle(origin)
  if (page !== null) return `${title ?? 'PDF'} ${page}쪽`

  const noteTitle = origin
    ?.closest('.note-tab')
    ?.querySelector<HTMLElement>('.note-toolbar__path')
    ?.textContent?.trim()
  if (noteTitle !== undefined && noteTitle !== '') return noteTitle

  const kind = origin?.closest<HTMLElement>('[data-kind]')?.dataset['kind']
  if (title !== null) return title
  if (kind === 'chat') return '채팅'
  if (kind === 'board') return '학업 보드'
  return 'Bandal'
}

function lastRangeRect(range: Range): SelectionAnchorRect | null {
  const rects = [...range.getClientRects()].filter(
    (rect) => rect.width > 0 || rect.height > 0
  )
  const rect = rects.at(-1) ?? range.getBoundingClientRect()
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null
  if (rect.width === 0 && rect.height === 0) return null
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
}

function rendererSelection(id: number): AnchoredSelection | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const origin = elementForNode(selection.anchorNode)
  const focus = elementForNode(selection.focusNode)
  if (
    (origin !== null && origin.closest('[data-assistant-layer]') !== null) ||
    (focus !== null && focus.closest('[data-assistant-layer]') !== null)
  ) {
    return null
  }

  const range = selection.getRangeAt(0)
  const pdf = readPageSelection(selection)
  if (pdf !== null) {
    const layer = pdf.pageElement.querySelector<HTMLElement>('.textLayer')
    const pageText = layer === null ? '' : textLayerText(layer)
    const text = pageText.includes(pdf.anchor.quote)
      ? pdf.anchor.quote.trim()
      : selection.toString().trim()
    const endRect = pdf.clientRects.at(-1) ?? pdf.boundsClientRect
    if (text === '') return null
    return {
      id,
      text,
      rect: endRect,
      source: rendererSource(origin, pdf.page),
      kind: 'renderer'
    }
  }

  const text = selection.toString().trim()
  const rect = lastRangeRect(range)
  if (text === '' || rect === null) return null
  return {
    id,
    text,
    rect,
    source: rendererSource(origin, null),
    kind: 'renderer'
  }
}

function browserSource(detail: BrowserSelectionDetail): string {
  const title = detail.title.trim()
  const url = detail.url.trim()
  if (title !== '' && url !== '') return `${title} — ${url}`
  if (url !== '') return url
  if (title !== '') return title
  return '브라우저'
}

export interface SelectionAnchorApi {
  selection: AnchoredSelection | null
  clear: () => void
}

/** Tracks both the renderer DOM and console-bridged webview selections. */
export function useSelectionAnchor(): SelectionAnchorApi {
  const sequenceRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const [selection, setSelection] = useState<AnchoredSelection | null>(null)

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setSelection(null)
  }, [])

  useEffect(() => {
    const readSoon = (): void => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        sequenceRef.current += 1
        setSelection(rendererSelection(sequenceRef.current))
      }, SELECTION_DEBOUNCE_MS)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clear()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clear()
      else readSoon()
    }
    const onScroll = (): void => clear()
    const onBrowserSelection = (rawEvent: Event): void => {
      const event = rawEvent as CustomEvent<BrowserSelectionDetail | null>
      const detail = event.detail
      if (detail === null) {
        clear()
        return
      }
      const text = detail.text.trim()
      if (text === '') {
        clear()
        return
      }
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      sequenceRef.current += 1
      setSelection({
        id: sequenceRef.current,
        text,
        rect: detail.rect,
        source: browserSource(detail),
        kind: 'browser'
      })
    }

    document.addEventListener('selectionchange', readSoon)
    document.addEventListener('mouseup', readSoon)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener(BROWSER_SELECTION_EVENT, onBrowserSelection)
    return () => {
      document.removeEventListener('selectionchange', readSoon)
      document.removeEventListener('mouseup', readSoon)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener(BROWSER_SELECTION_EVENT, onBrowserSelection)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [clear])

  return { selection, clear }
}
