import { workspaceWindowFromKey } from '../../../../shared/workspaceWindows'
import { workspaceFromKey } from '../../../../shared/types/workspace'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { tabDragSession, type WorkspaceTabDragSource } from './tabDragSession'

interface HoverNavigation {
  nonce: string
  origin: string | null
  expected: string | null
  navigated: boolean
  externalSelection: boolean
  pending: boolean
  accepted: boolean
  ended: boolean
}
const navigations = new Map<string, HoverNavigation>()
let selectingWorkspace = false
let pendingSources: readonly WorkspaceTabDragSource[] = []
const retentionListeners = new Set<() => void>()

/** Native dragend may precede a cold destination's hydration. Keep its source mounted. */
export const workspaceCourseMoveRetention = {
  getSnapshot: (): readonly WorkspaceTabDragSource[] => pendingSources,
  subscribe: (listener: () => void): (() => void) => {
    retentionListeners.add(listener)
    return () => { retentionListeners.delete(listener) }
  }
}

function retainSources(next: readonly WorkspaceTabDragSource[]): void {
  pendingSources = next
  for (const listener of retentionListeners) listener()
}

function finish(navigation: HoverNavigation): void {
  navigations.delete(navigation.nonce)
  const courses = useCoursesStore.getState()
  const current = useWorkspaceStore.getState().activeWorkspaceKey
  const expected = navigation.expected === null ? null : workspaceWindowFromKey(navigation.expected).workspaceKey
  const original = navigation.origin === null ? null : workspaceWindowFromKey(navigation.origin)
  if (!navigation.navigated || navigation.accepted || navigation.externalSelection ||
    tabDragSession.getSnapshot() !== null || (current !== expected && current !== (original?.workspaceKey ?? null)) ||
    (navigation.origin !== null && !courses.courses.some(course => course.id === workspaceFromKey(navigation.origin!).courseId))) return
  const origin = navigation.origin === null ? null : workspaceFromKey(navigation.origin)
  courses.selectCourse(origin?.courseId ?? null, { preserveSurface: true })
  // Cancel even a hover transition still waiting for its preview capture, and
  // restore the exact canvas where this drag began.
  if (origin && original) useWorkspaceStore.getState().showWorkspaceWindow(origin, original.windowId)
  else useWorkspaceStore.getState().showWorkspace(null)
}

/** Hover navigation belongs to one drag, not to the tab's resource binding. */
export function installWorkspaceCourseMoveNavigation(): () => void {
  let activeNonce: string | null = null
  const sourceChanged = (): void => {
    const source = tabDragSession.getSource()
    if ((source?.nonce ?? null) === activeNonce) return
    const previous = activeNonce ? navigations.get(activeNonce) : undefined
    activeNonce = source?.nonce ?? null
    if (previous) { previous.ended = true; if (!previous.pending) finish(previous) }
    if (source) {
      const origin = useWorkspaceStore.getState().activeWindowKey
      navigations.set(source.nonce, { nonce: source.nonce, origin, expected: origin, navigated: false,
        externalSelection: false, pending: false, accepted: false, ended: false })
    }
  }
  const stopSource = tabDragSession.subscribe(sourceChanged)
  const stopCourse = useWorkspaceStore.subscribe((state, previous) => {
    if (selectingWorkspace || state.activeWorkspaceKey === previous.activeWorkspaceKey) return
    for (const navigation of navigations.values()) {
      if ((navigation.nonce === activeNonce || navigation.pending) && state.activeWorkspaceKey !== (navigation.expected === null ? null : workspaceWindowFromKey(navigation.expected).workspaceKey))
        navigation.externalSelection = true
    }
  })
  const stopOwner = useCoursesStore.subscribe((state, previous) => {
    if (selectingWorkspace || state.selectedCourseId === previous.selectedCourseId) return
    for (const navigation of navigations.values()) {
      const expectedOwner = navigation.expected === null ? null : workspaceFromKey(navigation.expected).courseId
      if ((navigation.nonce === activeNonce || navigation.pending) && state.selectedCourseId !== expectedOwner) navigation.externalSelection = true
    }
  })
  sourceChanged()
  return () => { stopSource(); stopCourse(); stopOwner(); navigations.clear(); retainSources([]) }
}

export function navigateWorkspaceCourseHover(nonce: string, courseId: string): boolean {
  if (tabDragSession.getSource()?.nonce !== nonce) return false
  const navigation = navigations.get(nonce)
  if (navigation?.externalSelection) return false
  if (navigation) { navigation.expected = courseId; navigation.navigated = true }
  const workspace = workspaceFromKey(courseId)
  selectingWorkspace = true
  try {
    useCoursesStore.getState().selectCourse(workspace.courseId, { preserveSurface: true })
    useWorkspaceStore.getState().showWorkspace(workspace)
  } finally { selectingWorkspace = false }
  return true
}

export function beginWorkspaceCourseMoveDrop(nonce: string): boolean {
  const source = tabDragSession.getSource()
  if (!source || source.nonce !== nonce || pendingSources.some(entry => entry.nonce === nonce)) return false
  const navigation = navigations.get(nonce)
  if (navigation) {
    if (navigation.pending || navigation.accepted || navigation.ended) return false
    navigation.pending = true
  }
  retainSources([...pendingSources, source])
  return true
}

export function finishWorkspaceCourseMoveDrop(nonce: string, accepted: boolean): void {
  const navigation = navigations.get(nonce)
  if (navigation) {
    navigation.pending = false
    navigation.accepted = accepted
    if (navigation.ended) finish(navigation)
  }
  retainSources(pendingSources.filter(source => source.nonce !== nonce))
}

export function isWorkspaceCourseMoveDropCurrent(nonce: string): boolean {
  const navigation = navigations.get(nonce)
  return pendingSources.some(source => source.nonce === nonce) && (!navigation || !navigation.externalSelection)
}

/** A valid favorite copy keeps its chosen screen without moving the live tab. */
export function acceptWorkspaceCourseCopyDrop(nonce: string): void {
  const navigation = navigations.get(nonce)
  if (navigation?.navigated && !navigation.pending && !navigation.ended && tabDragSession.getSource()?.nonce === nonce) navigation.accepted = true
}
