import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from 'react'
import type { LearningArticleSnapshot, LearningProjectSnapshot, SaveLearningProgressInput } from '../../../../shared/types/learning'
import { invoke } from '../../lib/ipc'
import { registerResourceCloseGuard } from '../workspace/tabCloseGuard'

type ReadingPosition = Pick<SaveLearningProgressInput, 'paragraphId' | 'scrollFraction'>

/** Keep a stable paragraph when the same article is reopened in a differently sized pane. */
export function restoreReaderPosition(element: HTMLElement, position: ReadingPosition | undefined): void {
  if (!position) { element.scrollTop = 0; return }
  const paragraph = Array.from(element.querySelectorAll<HTMLElement>('[data-learning-paragraph]'))
    .find(item => item.dataset.learningParagraph === position.paragraphId)
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
  if (position.scrollFraction === 0 || position.scrollFraction === 1) { element.scrollTop = position.scrollFraction * maximum; return }
  const target = paragraph
    ? element.scrollTop + paragraph.getBoundingClientRect().top - element.getBoundingClientRect().top - 100
    : position.scrollFraction * maximum
  element.scrollTop = Math.max(0, Math.min(maximum, target))
}

export function useReaderProgress(root: RefObject<HTMLDivElement>, project: LearningProjectSnapshot, article: LearningArticleSnapshot,
  onUpdate: (value: LearningProjectSnapshot) => void, onError: (error: unknown) => void, visible = true
): { fraction: number; onScroll: (event: UIEvent<HTMLDivElement>) => void; flush: () => Promise<void> } {
  const key = JSON.stringify([project.projectId, project.binding.courseId, project.binding.rootRelPath, article.id])
  const currentKey = useRef(key); currentKey.current = key
  const mounted = useRef(false)
  const callbacks = useRef({ onUpdate, onError }); callbacks.current = { onUpdate, onError }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const position = useRef<ReadingPosition | null>(null)
  const saving = useRef<Promise<void> | null>(null)
  // Keep the last read paragraph even after its debounced save has been flushed.
  const resumePosition = useRef<ReadingPosition | undefined>(undefined)
  const [fraction, setFraction] = useState(0)
  const binding = project.binding

  const save = useCallback(async (value: ReadingPosition, notify: boolean): Promise<void> => {
    const next = await invoke('learning:saveProgress', { binding, articleId: article.id, ...value })
    if (notify && mounted.current && currentKey.current === key) callbacks.current.onUpdate(next)
  }, [key])

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    // A debounce/hide flush may already have taken the pending position. A
    // folder move must wait for that write as well as any newer scroll event.
    while (saving.current) await saving.current
    const value = position.current; position.current = null
    if (!value) return
    const pending = save(value, true)
    saving.current = pending
    try { await pending }
    catch (error) { if (currentKey.current === key && !position.current) position.current = value; throw error }
    finally { if (saving.current === pending) saving.current = null }
  }, [save, key])

  useEffect(() => registerResourceCloseGuard({ kind: 'learning-resource', payload: { ...binding, resource: { kind: 'article', id: article.id } } }, async () => {
    try { do { await flush() } while (position.current); return true } catch (error) { callbacks.current.onError(error); return false }
  }), [key, flush])

  useLayoutEffect(() => {
    mounted.current = true
    position.current = null
    const previous = project.articles.find(item => item.id === article.id)?.progress
    resumePosition.current = previous
    if (root.current) restoreReaderPosition(root.current, previous)
    setFraction(previous?.scrollFraction ?? 0)
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      const value = position.current; position.current = null
      if (value) void save(value, false).catch(() => { /* The reader has gone away; do not surface an error in a different article. */ })
    }
  }, [key])

  useLayoutEffect(() => {
    if (!visible) {
      void flush().catch(error => { if (mounted.current && currentKey.current === key) callbacks.current.onError(error) })
      return
    }
    // Dockview keeps hidden tabs mounted. Restore after its content host has sized
    // the pane, so a width change while another tab was open keeps the paragraph.
    const frame = requestAnimationFrame(() => {
      if (root.current && root.current.clientHeight > 0) restoreReaderPosition(root.current, resumePosition.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [key, visible, flush])

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget
    if (!visible || !element.clientHeight) return
    const scrollFraction = Math.max(0, Math.min(1, element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight)))
    const top = element.getBoundingClientRect().top
    const visibleParagraph = Array.from(element.querySelectorAll<HTMLElement>('[data-learning-paragraph]'))
      .find(item => item.getBoundingClientRect().bottom > top + 100)
    position.current = { paragraphId: visibleParagraph?.dataset.learningParagraph ?? null, scrollFraction }
    resumePosition.current = position.current
    setFraction(scrollFraction)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void flush().catch(error => { if (mounted.current && currentKey.current === key) callbacks.current.onError(error) })
    }, 700)
  }
  return { fraction, onScroll, flush }
}
