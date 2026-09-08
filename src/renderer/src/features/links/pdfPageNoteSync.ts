import { useCallback, useEffect, useState } from 'react'

export interface PageSyncAnchor {
  connectionId: string
  pairId: string
  page: number
  pageOffset: number
  originPanelId: string
  sequence: number
}

const ANCHOR_EVENT = 'bandal:pdf-page-note-anchor'
const SETTING_EVENT = 'bandal:pdf-page-note-sync-setting'
/** Fallback release when assigning scrollTop produces no scroll event. */
export const PAGE_SYNC_ECHO_GUARD_MS = 150
const settings = new Map<string, boolean>()
let sequence = 0

export function publishPageSyncAnchor(
  anchor: Omit<PageSyncAnchor, 'sequence'>
): void {
  window.dispatchEvent(
    new CustomEvent<PageSyncAnchor>(ANCHOR_EVENT, {
      detail: { ...anchor, sequence: ++sequence }
    })
  )
}

export function subscribePageSyncAnchor(
  pairId: string,
  listener: (anchor: PageSyncAnchor) => void
): () => void {
  const handle = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as PageSyncAnchor
    if (detail.pairId === pairId) listener(detail)
  }
  window.addEventListener(ANCHOR_EVENT, handle)
  return () => window.removeEventListener(ANCHOR_EVENT, handle)
}

export function setPageNoteSyncEnabled(pairId: string, enabled: boolean): void {
  settings.set(pairId, enabled)
  window.dispatchEvent(
    new CustomEvent(SETTING_EVENT, { detail: { pairId, enabled } })
  )
}

export function pageNoteSyncEnabled(
  pairId: string,
  defaultEnabled = true
): boolean {
  return settings.get(pairId) ?? defaultEnabled
}

export function usePageNoteSync(
  pairId: string | null,
  defaultEnabled = true
): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() =>
    pairId === null ? false : pageNoteSyncEnabled(pairId, defaultEnabled)
  )

  useEffect(() => {
    if (pairId === null) {
      setEnabled(false)
      return
    }
    if (!settings.has(pairId)) settings.set(pairId, defaultEnabled)
    setEnabled(pageNoteSyncEnabled(pairId, defaultEnabled))
    const handle = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { pairId?: unknown; enabled?: unknown }
      if (detail.pairId === pairId && typeof detail.enabled === 'boolean') {
        setEnabled(detail.enabled)
      }
    }
    window.addEventListener(SETTING_EVENT, handle)
    return () => window.removeEventListener(SETTING_EVENT, handle)
  }, [defaultEnabled, pairId])

  const update = useCallback(
    (next: boolean): void => {
      if (pairId !== null) setPageNoteSyncEnabled(pairId, next)
    },
    [pairId]
  )
  return [enabled, update]
}
