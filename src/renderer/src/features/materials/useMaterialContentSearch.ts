import { useEffect, useRef, useState } from 'react'
import type { ContentSearchIndexStatus, SearchHit } from '../../../../shared/types/search'
import { invoke, onPush } from '../../lib/ipc'

export function useMaterialContentSearch(courseId: string | null, query: string, rootRelPath: string) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; hits: SearchHit[]; indexing?: ContentSearchIndexStatus; error?: string } | null>(null)
  const [pending, setPending] = useState(false)
  const requestedKey = useRef<string | null>(null)
  const normalized = query.trim()
  const key = JSON.stringify([courseId, normalized, rootRelPath])
  useEffect(() => {
    if (!courseId || !normalized) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (event: { courseId: string }): void => {
      if (event.courseId !== courseId || timer !== undefined) return
      // Throttle batches rather than postponing every time an index page
      // finishes. Continuous indexing must not starve visible search results.
      timer = setTimeout(() => { timer = undefined; setRevision(value => value + 1) }, 100)
    }
    const offSearch = onPush('search:changed', changed)
    const offMaterials = onPush('materials:changed', changed)
    return () => { clearTimeout(timer); offSearch(); offMaterials() }
  }, [courseId, normalized, rootRelPath])
  useEffect(() => {
    if (!courseId || !normalized) { setPending(false); return }
    let current = true
    setPending(true)
    const timer = window.setTimeout(() => {
      requestedKey.current = key
      void invoke('search:query', { courseId, query: normalized, rootRelPath, limit: 100 }).then(value => {
        if (current) setResult({ key, ...value })
      }).catch(error => {
        if (current) setResult({ key, hits: [], error: error instanceof Error ? error.message : '본문을 검색하지 못했어요.' })
      }).finally(() => { if (current) setPending(false) })
    }, requestedKey.current === key ? 0 : 240)
    return () => { current = false; window.clearTimeout(timer) }
  }, [courseId, normalized, rootRelPath, key, revision])
  return { hits: result?.key === key ? result.hits : [], indexing: result?.key === key ? result.indexing : undefined,
    error: result?.key === key ? result.error : undefined, pending: !!courseId && !!normalized && (pending || result?.key !== key),
    retry: () => setRevision(value => value + 1) }
}
