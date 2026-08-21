/** Publishes the non-browser workspace tabs visible to the student. */

import { useEffect } from 'react'
import type { TabDescriptor } from '../../../../shared/tabs'
import { invoke } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  isTabDescriptor,
  tabPanelId,
  tabTitle
} from '../workspace/tabIdentity'

export interface AgentWorkspaceTab {
  kind: string
  title: string
  active: boolean
}

export interface AgentWorkspaceSyncPayload {
  selectedCourseId: string | null
  tabs: AgentWorkspaceTab[]
}

export interface WorkspaceSyncSources {
  openTabs: Record<string, TabDescriptor>
  activeDescriptor: TabDescriptor | null
  selectedCourseId: string | null
  hydration: string
}

/** Builds the renderer-owned view of the non-browser workspace. */
export function workspaceSyncPayload(
  sources: WorkspaceSyncSources
): AgentWorkspaceSyncPayload | null {
  if (sources.hydration !== 'ready') return null

  const activePanelId =
    sources.activeDescriptor === null
      ? null
      : tabPanelId(sources.activeDescriptor)
  let activeFound = false
  const tabs: AgentWorkspaceTab[] = []

  for (const descriptor of Object.values(sources.openTabs)) {
    if (!isTabDescriptor(descriptor) || descriptor.kind === 'browser') continue

    const active =
      !activeFound &&
      activePanelId !== null &&
      tabPanelId(descriptor) === activePanelId
    if (active) activeFound = true

    tabs.push({
      kind: descriptor.kind,
      title: tabTitle(descriptor),
      active
    })
  }

  return {
    selectedCourseId: sources.selectedCourseId,
    tabs
  }
}

function currentPayload(): AgentWorkspaceSyncPayload | null {
  const workspace = useWorkspaceStore.getState()
  return workspaceSyncPayload({
    openTabs: workspace.openTabs,
    activeDescriptor: workspace.activeTabDescriptor(),
    selectedCourseId: useCoursesStore.getState().selectedCourseId,
    hydration: workspace.hydration
  })
}

const SYNC_DEBOUNCE_MS = 200

/** Keeps main's cached view of the student's app workspace current. */
export function useAgentWorkspaceSync(): void {
  useEffect(() => {
    let timer: number | null = null
    let lastSent = ''

    const publish = (): void => {
      timer = null
      const payload = currentPayload()
      if (payload === null) return
      const serialized = JSON.stringify(payload)
      if (serialized === lastSent) return

      try {
        const request = invoke('agent:syncWorkspace', payload)
        lastSent = serialized
        void request.catch(() => {
          // The agent simply will not see this snapshot; do not disturb the student.
        })
      } catch {
        // A synchronous transport failure must not escape a store notification.
      }
    }

    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(publish, SYNC_DEBOUNCE_MS)
    }

    schedule()
    const unsubWorkspace = useWorkspaceStore.subscribe(schedule)
    const unsubCourses = useCoursesStore.subscribe(schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      unsubWorkspace()
      unsubCourses()
    }
  }, [])
}
