import { openWorkspaceAssistant } from '../features/assistantPanel/assistantController'
import { workspaceMaterialRoot } from '../../../shared/types/workspace'
/**
 * Tab-creating commands shared by the ⌘-shortcuts and the new-tab omnibox.
 *
 * These live outside the workspace feature so both callers reach the same
 * implementation: a shortcut that opened a *slightly different* markdown tab
 * than the menu would be a silent divergence nobody notices until it bites.
 */

import { v4 as uuidv4 } from 'uuid'
import { openNewNoteSheet } from '../features/pdfNotes/NewNoteSheet'
import type { TabDescriptor } from '../../../shared/tabs'
import { invoke } from '../lib/ipc'
import { useCoursesStore } from '../stores/coursesStore'
import { useMaterialsStore } from '../stores/materialsStore'
import { settingsSnapshot } from '../stores/settingsSnapshot'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { descriptorFor } from '../features/workspace/tabIdentity'
import { showToast } from './toast'
import type { WorkspaceTarget } from '../features/workspace/placementContext'
import { captureActiveWorkspaceTarget } from '../features/workspace/captureWorkspaceTarget'

export const DEFAULT_BROWSER_URL = 'https://www.google.com'

/** `새 마크다운 2026-08-07 00.54` — stable, sortable, collision-resistant. */
export function defaultMarkdownTitle(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`
  return `${settingsSnapshot().tabs.markdownTitlePrefix} ${date} ${time}`
}

function activeCourseId(): string | null {
  if (useWorkspaceStore.getState().surface !== 'course') return null
  return useCoursesStore.getState().selectedCourseId
}

/** Creates a .md in the course root and opens it. No-op without a course. */
export async function createMarkdownTab(title?: string, target?: WorkspaceTarget): Promise<void> {
  target ??= captureActiveWorkspaceTarget()
  if (!target || target.courseId === null) return
  const courseId = target.courseId
  const captured = target.workspace ?? { kind: 'course' as const, courseId }
  try {
    const ref = await invoke('notes:create', {
      courseId,
      dirRelPath: workspaceMaterialRoot(captured),
      title: title ?? defaultMarkdownTitle(new Date())
    })
    useWorkspaceStore.getState().openTab(descriptorFor('note', ref), { target })
    void useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
  } catch (error) {
    console.error('[Bandal] 마크다운을 만들지 못했습니다.', error)
    showToast('필기를 만들지 못했어요. 다시 시도해 주세요.', 'danger')
  }
}

/** The keyboard picker creates a note immediately using the saved paper defaults. */
export async function createDefaultNoteTab(target?: WorkspaceTarget): Promise<void> {
  target ??= captureActiveWorkspaceTarget()
  if (!target || target.courseId === null) return
  const courseId = target.courseId
  const captured = target.workspace ?? { kind: 'course' as const, courseId }
  const now = new Date()
  const title = `노트 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const { notePaper: paper, noteOrientation: orientation } = settingsSnapshot().tabs
  try {
    const { relPath } = await invoke('pdfNotes:create', { courseId, title, paper, orientation, ...(captured?.kind === 'project' ? { dirRelPath: workspaceMaterialRoot(captured) } : {}) })
    const descriptor = descriptorFor('pdf', { courseId, relPath })
    useWorkspaceStore.getState().openTab(descriptor, { target })
    void useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
  } catch (error) {
    console.error('[Bandal] 노트를 만들지 못했습니다.', error)
    showToast('노트를 만들지 못했어요. 다시 시도해 주세요.', 'danger')
  }
}

export function createBrowserTab(url?: string, target?: WorkspaceTarget): void {
  const homePage = settingsSnapshot().browser.homePage
  const initialUrl = url ?? (homePage !== '' ? homePage : DEFAULT_BROWSER_URL)
  useWorkspaceStore
    .getState()
    .openTab(descriptorFor('browser', { tabId: uuidv4(), initialUrl }), target ? { target } : undefined)
}

export async function createStudyTab(
  kind: 'chat' | 'recording' | 'whiteboard' | 'board',
  target?: WorkspaceTarget
): Promise<void> {
  if (kind === 'whiteboard') target ??= captureActiveWorkspaceTarget()
  const courseId = target ? target.courseId : activeCourseId()
  const open = (descriptor: TabDescriptor): void => {
    if (target) useWorkspaceStore.getState().openTab(descriptor, { target })
    else useWorkspaceStore.getState().openTab(descriptor)
  }
  if (kind === 'board') {
    open(descriptorFor('board', {}))
    return
  }
  if (courseId === null) return
  if (kind === 'chat') {
    const workspace = target ? target.workspace ?? { kind: 'course' as const, courseId: target.courseId! } : useWorkspaceStore.getState().activeWorkspace ?? { kind: 'course' as const, courseId }
    openWorkspaceAssistant(workspace, { conversationId: uuidv4() })
  } else if (kind === 'recording') {
    open(descriptorFor('recording', { courseId }))
  } else {
    openNewNoteSheet(courseId, target)
  }
}
