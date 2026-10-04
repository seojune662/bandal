import { useSyncExternalStore } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { showToast } from '../../app/toast'
import { descriptorFor } from '../workspace/tabIdentity'

interface AssistantController {
  courseId: string | null
  open: boolean
  show(): void
  focus(): void
}

const controllers = new Map<string, AssistantController>()
const listeners = new Set<() => void>()
const pendingFocus = new Set<string>()
let pendingCourseFocus: string | null = null
const keyFor = (panelId: string, courseId: string | null): string => JSON.stringify([courseId, panelId])
const notify = (): void => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Connect shell shortcuts to each tab's existing state and composer. */
export function registerAssistantController(panelId: string, controller: AssistantController,
  workspaceCourseId: string | null = controller.courseId): () => void {
  const key = keyFor(panelId, workspaceCourseId)
  controllers.set(key, controller)
  notify()
  const workspace = useWorkspaceStore.getState()
  const source = workspace.activePanelSource()
  if (workspace.activeCourseId === workspaceCourseId && source?.panelId === panelId && (pendingFocus.delete(key) ||
      (source.descriptor.kind === 'chat' && pendingCourseFocus === controller.courseId))) {
    pendingCourseFocus = null
    controller.focus()
  }
  return () => {
    if (controllers.get(key) !== controller) return
    controllers.delete(key)
    pendingFocus.delete(key)
    notify()
  }
}

function focusPanel(panelId: string): void {
  const key = keyFor(panelId, useWorkspaceStore.getState().activeCourseId)
  const controller = controllers.get(key)
  if (controller) controller.focus()
  else pendingFocus.add(key)
}

/** Opening never creates a replacement conversation for an existing document. */
export function openActiveAssistant(): void {
  const workspace = useWorkspaceStore.getState()
  const source = workspace.activePanelSource()
  const controller = source && controllers.get(keyFor(source.panelId, workspace.activeCourseId))
  if (controller?.courseId) {
    pendingCourseFocus = null
    pendingFocus.clear()
    controller.show()
    controller.focus()
    return
  }

  const { selectedCourseId, courses } = useCoursesStore.getState()
  if (!selectedCourseId || !courses.some(course => course.id === selectedCourseId)) {
    useUiStore.getState().showCourses()
    showToast('과목을 선택하면 AI와 대화할 수 있어요.')
    return
  }

  // Focus by actual panel identity: legacy chat tabs retain their old panel ID
  // even after ChatTab normalizes the descriptor to a specific conversation.
  const existing = workspace.activeCourseId === selectedCourseId
    ? Object.entries(workspace.openTabs).find(([, descriptor]) =>
      descriptor.kind === 'chat' && descriptor.payload.courseId === selectedCourseId)
    : undefined
  if (existing) {
    workspace.activatePanel(existing[0])
    focusPanel(existing[0])
    return
  }
  pendingCourseFocus = selectedCourseId
  workspace.openTab(descriptorFor('chat', { courseId: selectedCourseId }))
  const opened = workspace.activePanelSource()
  if (opened?.descriptor.kind === 'chat' && opened.descriptor.payload.courseId === selectedCourseId) {
    pendingCourseFocus = null
    focusPanel(opened.panelId)
  }
}

export function useActiveAssistantOpen(): boolean {
  const panelId = useWorkspaceStore(state => state.activePanelId)
  const courseId = useWorkspaceStore(state => state.activeCourseId)
  return useSyncExternalStore(subscribe, () => panelId ? controllers.get(keyFor(panelId, courseId))?.open === true : false, () => false)
}

/** Test-only reset; production registrations are released with their panels. */
export function resetAssistantControllersForTests(): void {
  controllers.clear()
  pendingFocus.clear()
  pendingCourseFocus = null
  notify()
}
