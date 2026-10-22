import type { WorkspaceRef } from '../../../../shared/types/workspace'

const LAST_WORKSPACE = 'bandal:last-workspace'
export function rememberedWorkspace(): WorkspaceRef | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_WORKSPACE) ?? 'null')
    if (!value || typeof value !== 'object' || !('kind' in value) || !('courseId' in value) || typeof value.courseId !== 'string' || !value.courseId) return null
    if (value.kind === 'course') return { kind: 'course', courseId: value.courseId }
    if (value.kind === 'project' && 'rootRelPath' in value && typeof value.rootRelPath === 'string') return { kind: 'project', courseId: value.courseId, rootRelPath: value.rootRelPath }
  } catch { /* A malformed or unavailable optional preference is ignored. */ }
  return null
}
export function rememberWorkspace(workspace: WorkspaceRef | null): void {
  try { if (workspace) localStorage.setItem(LAST_WORKSPACE, JSON.stringify(workspace)); else localStorage.removeItem(LAST_WORKSPACE) } catch { /* Layout persistence remains authoritative. */ }
}
