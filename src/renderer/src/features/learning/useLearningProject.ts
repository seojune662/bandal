import { useCallback, useSyncExternalStore } from 'react'
import type { LearningBinding, LearningProjectSnapshot } from '../../../../shared/types/learning'
import { invoke, onPush } from '../../lib/ipc'
import { learningError } from './learningNavigation'
import { findMovedLearningBinding } from './learningRelocation'
import { flushLearningResourcesForPath, reconcileWorkspaceMaterialRename } from '../../stores/workspaceStore'
import { showToast } from '../../app/toast'

interface Snapshot { project: LearningProjectSnapshot | null; loading: boolean; error: string | null }
interface Entry { snapshot: Snapshot; listeners: Set<() => void>; stop?: () => void; sequence: number; projectId?: string }
const entries = new Map<string, Entry>()
const keyFor = (binding: LearningBinding): string => JSON.stringify([binding.courseId, binding.rootRelPath])
function entryFor(binding: LearningBinding): Entry {
  const key = keyFor(binding)
  let entry = entries.get(key)
  if (!entry) { entry = { snapshot: { project: null, loading: true, error: null }, listeners: new Set(), sequence: 0 }; entries.set(key, entry) }
  return entry
}
function publish(entry: Entry, snapshot: Snapshot): void { entry.snapshot = snapshot; entry.listeners.forEach(listener => listener()) }
export function updateLearningProjectSnapshot(project: LearningProjectSnapshot): void {
  const entry = entryFor(project.binding)
  if (entry.snapshot.project && entry.snapshot.project.revision > project.revision) return
  publish(entry, { project, loading: false, error: null })
}
export async function refreshLearningProject(binding: LearningBinding): Promise<void> {
  const entry = entryFor(binding), sequence = ++entry.sequence
  try {
    const project = await invoke('learning:get', { binding })
    if (entry.sequence === sequence) updateLearningProjectSnapshot(project)
  } catch (error) {
    const projectId = entry.snapshot.project?.projectId ?? entry.projectId
    if (projectId) {
      try {
        const result = await invoke('learning:list', { courseId: binding.courseId })
        const moved = findMovedLearningBinding(binding, projectId, result.projects)
        if (moved && entry.sequence === sequence) {
          if (!await flushLearningResourcesForPath(binding.courseId, binding.rootRelPath)) {
            const message = '프로젝트 폴더 위치가 바뀌었지만 저장하지 못한 학습 내용이 있어 기존 창을 유지했어요. 폴더를 원래 위치로 되돌린 뒤 저장을 다시 시도해 주세요.'
            showToast(message, 'danger')
            // Preserve the rendered reader/quiz and its in-memory failed draft.
            // An error screen here would unmount the very content being saved.
            if (entry.sequence === sequence) publish(entry, { ...entry.snapshot, loading: false })
            return
          }
          if (entry.sequence !== sequence) return
          reconcileWorkspaceMaterialRename(binding.courseId, binding.rootRelPath, moved.rootRelPath)
          return
        }
      } catch { /* Keep the original read error when rediscovery fails. */ }
    }
    if (entry.sequence === sequence) publish(entry, { ...entry.snapshot, loading: false, error: learningError(error) })
  }
}
/** One subscription and monotonic project state shared by all split resource tabs. */
export function useLearningProject(binding: LearningBinding, projectId?: string): Snapshot {
  const key = keyFor(binding), entry = entryFor(binding)
  if (projectId) entry.projectId = projectId
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener)
    if (entry.listeners.size === 1) {
      void refreshLearningProject(binding)
      const stopLearning = onPush('learning:changed', event => { if (event.binding.courseId === binding.courseId) void refreshLearningProject(binding) })
      const stopMaterials = onPush('materials:changed', event => { if (event.courseId === binding.courseId) void refreshLearningProject(binding) })
      entry.stop = () => { stopLearning(); stopMaterials() }
    }
    return () => { entry.listeners.delete(listener); if (!entry.listeners.size) { entry.stop?.(); delete entry.stop } }
  }, [entry, key])
  return useSyncExternalStore(subscribe, () => entry.snapshot)
}
