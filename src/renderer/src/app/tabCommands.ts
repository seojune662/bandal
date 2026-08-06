/**
 * Tab-creating commands shared by the ⌘-shortcuts and the new-tab omnibox.
 *
 * These live outside the workspace feature so both callers reach the same
 * implementation: a shortcut that opened a *slightly different* markdown tab
 * than the menu would be a silent divergence nobody notices until it bites.
 */

import { v4 as uuidv4 } from 'uuid'
import { invoke } from '../lib/ipc'
import { useCoursesStore } from '../stores/coursesStore'
import { useMaterialsStore } from '../stores/materialsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { descriptorFor } from '../features/workspace/tabIdentity'

export const DEFAULT_BROWSER_URL = 'https://www.google.com'

/** `새 마크다운 2026-08-07 00.54` — stable, sortable, collision-resistant. */
export function defaultMarkdownTitle(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`
  return `새 마크다운 ${date} ${time}`
}

function activeCourseId(): string | null {
  return useCoursesStore.getState().selectedCourseId
}

/** Creates a .md in the course root and opens it. No-op without a course. */
export async function createMarkdownTab(title?: string): Promise<void> {
  const courseId = activeCourseId()
  if (courseId === null) return
  try {
    const ref = await invoke('notes:create', {
      courseId,
      dirRelPath: '',
      title: title ?? defaultMarkdownTitle(new Date())
    })
    useWorkspaceStore.getState().openTab(descriptorFor('note', ref))
    void useMaterialsStore.getState().loadTree(courseId)
  } catch (error) {
    console.error('[Bandal] 마크다운을 만들지 못했습니다.', error)
  }
}

export function createBrowserTab(url: string = DEFAULT_BROWSER_URL): void {
  useWorkspaceStore.getState().openTab(
    descriptorFor('browser', { tabId: uuidv4(), initialUrl: url })
  )
}
