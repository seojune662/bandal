import { workspaceWindowFromKey } from '../workspaceWindows'
/** A layout belongs to a workspace; its documents retain their original owners. */
export type WorkspaceRef =
  | { kind: 'course'; courseId: string }
  | { kind: 'project'; courseId: string; rootRelPath: string }

/** Ordinary course keys remain compatible with existing layout callers. */
export function workspaceKey(workspace: WorkspaceRef): string {
  return workspace.kind === 'course' ? workspace.courseId : `project:${JSON.stringify([workspace.courseId, workspace.rootRelPath])}`
}

export function workspaceFromKey(key: string): WorkspaceRef {
  key = workspaceWindowFromKey(key).workspaceKey
  if (key.startsWith('project:[')) {
    try {
      const value: unknown = JSON.parse(key.slice('project:'.length))
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string') {
        return { kind: 'project', courseId: value[0], rootRelPath: value[1] }
      }
    } catch { /* A legacy course id is still a valid course key. */ }
  }
  return { kind: 'course', courseId: key }
}

export function workspaceMaterialRoot(workspace: WorkspaceRef | null): string {
  return workspace?.kind === 'project' ? workspace.rootRelPath : ''
}

export function workspaceLayoutScope(workspace: WorkspaceRef): { courseId: string; projectRootRelPath?: string } {
  return workspace.kind === 'project'
    ? { courseId: workspace.courseId, projectRootRelPath: workspace.rootRelPath }
    : { courseId: workspace.courseId }
}

export function sameWorkspace(first: WorkspaceRef | null, second: WorkspaceRef | null): boolean {
  return first === null || second === null ? first === second : workspaceKey(first) === workspaceKey(second)
}
