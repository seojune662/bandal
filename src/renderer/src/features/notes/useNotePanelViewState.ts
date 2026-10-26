import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { FLUSH_PANEL_VIEW_STATE, type NotePanelViewState } from '../workspace/panelViewState'

const SCROLLERS = '.note-editor-scroll, .note-quiz-preview__scroll'

/** View settings belong to the panel; markdown continues through the shared document channel. */
export function useNotePanelViewState(options: {
  panelApi: IDockviewPanelProps['api']
  root: RefObject<HTMLElement>
  initial: NotePanelViewState | null
  visible: boolean
  ready: boolean
  revision: number
  mode: 'edit' | 'quiz'
  fontScale: number
}): void {
  const current = useRef(options)
  current.current = options
  const state = useRef<NotePanelViewState>(options.initial ?? { scrollTop: 0, mode: options.mode, fontScale: options.fontScale })
  const hasPosition = useRef(options.initial !== null)
  const restoring = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persisted = useRef('')
  const measure = useCallback((): void => {
    const { visible, ready, root } = current.current
    const scroller = root.current?.querySelector<HTMLElement>(SCROLLERS)
    if (visible && ready && !restoring.current && scroller && scroller.clientHeight > 0) {
      state.current.scrollTop = scroller.scrollTop
      hasPosition.current = true
    }
  }, [])
  const persist = useCallback((): void => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = null
    measure()
    const next = { ...state.current, mode: current.current.mode, fontScale: current.current.fontScale }
    state.current = next
    const serialized = JSON.stringify(next)
    if (serialized === persisted.current) return
    persisted.current = serialized
    current.current.panelApi.updateParameters({ noteViewState: next })
  }, [measure])

  useLayoutEffect(() => {
    // Fresh page-note pairs select their requested PDF page themselves.
    // Only a real saved/measured position may override that initial jump.
    if (!options.ready || !options.visible || !hasPosition.current) return
    const scrollTop = state.current.scrollTop
    restoring.current = true
    let cancelled = false
    const restore = (): void => {
      if (cancelled || !current.current.visible) return
      const scroller = current.current.root.current?.querySelector<HTMLElement>(SCROLLERS)
      if (scroller) scroller.scrollTop = scrollTop
    }
    const root = options.root.current
    const cancel = (): void => { cancelled = true; restoring.current = false }
    for (const event of ['wheel', 'pointerdown', 'keydown']) root?.addEventListener(event, cancel, true)
    const frame = requestAnimationFrame(restore)
    // Milkdown plugins can finish after the first layout frame.
    const retry = setTimeout(() => { restore(); restoring.current = false }, 160)
    return () => {
      cancelAnimationFrame(frame); clearTimeout(retry); restoring.current = false
      for (const event of ['wheel', 'pointerdown', 'keydown']) root?.removeEventListener(event, cancel, true)
    }
  }, [options.ready, options.revision, options.visible, options.mode, options.root])

  useEffect(() => {
    const root = options.root.current
    const scroll = (event: Event): void => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(SCROLLERS) || !current.current.visible || restoring.current) return
      measure()
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persist, 160)
    }
    root?.addEventListener('scroll', scroll, true)
    window.addEventListener(FLUSH_PANEL_VIEW_STATE, persist)
    window.addEventListener('beforeunload', persist)
    return () => {
      persist()
      root?.removeEventListener('scroll', scroll, true)
      window.removeEventListener(FLUSH_PANEL_VIEW_STATE, persist)
      window.removeEventListener('beforeunload', persist)
    }
  }, [options.root, persist, measure])

  useEffect(() => {
    if (options.ready) persist()
  }, [options.mode, options.fontScale, options.ready, persist])
}
