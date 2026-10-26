import { createContext, useContext } from 'react'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

/** Captured when an action starts; asynchronous work must not follow focus. */
export interface WorkspaceTarget {
  courseId: string | null
  workspace?: WorkspaceRef | null
  windowId?: string
  groupId?: string
}

/** Placement is independent of a document's original resource/course binding. */
export interface WorkspacePlacement {
  courseId: string | null
  workspace?: WorkspaceRef | null
  windowId?: string
  panelId: string
  instanceId: string
}

export const WorkspacePlacementContext = createContext<WorkspacePlacement | null>(null)
/** Dockview presentation slots use this before their content has an instance. */
export const WorkspaceRefContext = createContext<WorkspaceRef | null>(null)
export const WorkspaceWindowContext = createContext<string>('main')
export const WorkspaceCourseContext = createContext<string | null>(null)
export function useWorkspacePlacement(): WorkspacePlacement | null {
  return useContext(WorkspacePlacementContext)
}
