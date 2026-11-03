import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningProjectSummary } from '../../../../shared/types/learning'
import { invoke, onPush } from '../../lib/ipc'
import { LEARNING_CHANGED_EVENT, learningError } from './learningNavigation'
import './learning.css'

export function useLearningProjects(courseId?: string, includeDeleted = false): { projects: LearningProjectSummary[]; loading: boolean; error: string | null; reload: () => Promise<void> } {
  const [projects, setProjects] = useState<LearningProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    try { const result = await invoke('learning:list', { ...(courseId ? { courseId } : {}), ...(includeDeleted ? { includeDeleted: true } : {}) }); if (request === sequence.current) { setProjects(result.projects); setError(null) } }
    catch (caught) { if (request === sequence.current) setError(learningError(caught)) }
    finally { if (request === sequence.current) setLoading(false) }
  }, [courseId, includeDeleted])
  useEffect(() => { setLoading(true); let disposed = false
    const load = (): void => { if (!disposed) void reload() }
    load(); window.addEventListener(LEARNING_CHANGED_EVENT, load)
    const stop = onPush('learning:changed', () => { load() })
    const stopCourses = onPush('courses:changed', load)
    const stopMaterials = onPush('materials:changed', event => { if (!courseId || event.courseId === courseId) load() })
    return () => { disposed = true; sequence.current += 1; stop(); stopMaterials(); stopCourses(); window.removeEventListener(LEARNING_CHANGED_EVENT, load) }
  }, [reload])
  return { projects, loading, error, reload }
}
