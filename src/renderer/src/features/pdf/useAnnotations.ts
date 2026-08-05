/**
 * Annotation state for one open PDF: loads the file's annotations over IPC
 * and exposes create/update/remove that keep local state in sync with the
 * main-process store (immutably — new arrays on every change).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../../lib/ipc'
import type {
  Annotation,
  CreateAnnotationInput,
  HighlightColor,
  UpdateAnnotationInput
} from '../../../../shared/types/annotation'

export interface AnnotationsApi {
  annotations: Annotation[]
  byPage: Map<number, Annotation[]>
  /** Non-null after a failed IPC call; cleared by the next success. */
  error: string | null
  create(input: CreateAnnotationInput): Promise<Annotation | null>
  update(input: UpdateAnnotationInput): Promise<Annotation | null>
  remove(id: string): Promise<boolean>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '주석 저장 중 오류가 발생했어요.'
}

export function useAnnotations(
  courseId: string,
  relPath: string
): AnnotationsApi {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    invoke('annotations:listForFile', { courseId, relPath })
      .then((list) => {
        if (!cancelled) {
          setAnnotations(list)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause))
      })
    return () => {
      cancelled = true
    }
  }, [courseId, relPath])

  const create = useCallback(
    async (input: CreateAnnotationInput): Promise<Annotation | null> => {
      try {
        const created = await invoke('annotations:create', input)
        setAnnotations((current) => [...current, created])
        setError(null)
        return created
      } catch (cause: unknown) {
        setError(errorMessage(cause))
        return null
      }
    },
    []
  )

  const update = useCallback(
    async (input: UpdateAnnotationInput): Promise<Annotation | null> => {
      try {
        const updated = await invoke('annotations:update', input)
        setAnnotations((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry))
        )
        setError(null)
        return updated
      } catch (cause: unknown) {
        setError(errorMessage(cause))
        return null
      }
    },
    []
  )

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await invoke('annotations:delete', { id })
      setAnnotations((current) => current.filter((entry) => entry.id !== id))
      setError(null)
      return true
    } catch (cause: unknown) {
      setError(errorMessage(cause))
      return false
    }
  }, [])

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const annotation of annotations) {
      const list = map.get(annotation.page)
      if (list === undefined) {
        map.set(annotation.page, [annotation])
      } else {
        list.push(annotation)
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ay = a.rects[0]?.y ?? 0
        const by = b.rects[0]?.y ?? 0
        return ay - by
      })
    }
    return map
  }, [annotations])

  return { annotations, byPage, error, create, update, remove }
}

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'yellow',
  'green',
  'pink',
  'blue'
]
