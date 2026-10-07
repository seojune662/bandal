import { useCoursesStore } from '../../stores/coursesStore'
import { tabDragSession } from './tabDragSession'

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

function finish(navigation: HoverNavigation): void {
  navigations.delete(navigation.nonce)
  const courses = useCoursesStore.getState()
  if (!navigation.navigated || navigation.accepted || navigation.externalSelection ||
    tabDragSession.getSnapshot() !== null || courses.selectedCourseId !== navigation.expected ||
    (navigation.origin !== null && !courses.courses.some(course => course.id === navigation.origin))) return
  courses.selectCourse(navigation.origin)
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
      const origin = useCoursesStore.getState().selectedCourseId
      navigations.set(source.nonce, { nonce: source.nonce, origin, expected: origin, navigated: false,
        externalSelection: false, pending: false, accepted: false, ended: false })
    }
  }
  const stopSource = tabDragSession.subscribe(sourceChanged)
  const stopCourse = useCoursesStore.subscribe((state, previous) => {
    if (state.selectedCourseId === previous.selectedCourseId || !activeNonce) return
    const navigation = navigations.get(activeNonce)
    if (navigation && state.selectedCourseId !== navigation.expected) navigation.externalSelection = true
  })
  sourceChanged()
  return () => { stopSource(); stopCourse(); navigations.clear() }
}

export function navigateWorkspaceCourseHover(nonce: string, courseId: string): boolean {
  if (tabDragSession.getSource()?.nonce !== nonce) return false
  const navigation = navigations.get(nonce)
  if (navigation?.externalSelection) return false
  if (navigation) { navigation.expected = courseId; navigation.navigated = true }
  useCoursesStore.getState().selectCourse(courseId)
  return true
}

export function beginWorkspaceCourseMoveDrop(nonce: string): boolean {
  const navigation = navigations.get(nonce)
  if (!navigation) return true
  if (navigation.pending || navigation.accepted || navigation.ended) return false
  navigation.pending = true
  return true
}

export function finishWorkspaceCourseMoveDrop(nonce: string, accepted: boolean): void {
  const navigation = navigations.get(nonce)
  if (!navigation) return
  navigation.pending = false
  navigation.accepted = accepted
  if (navigation.ended) finish(navigation)
}

/** A valid favorite copy keeps its chosen screen without moving the live tab. */
export function acceptWorkspaceCourseCopyDrop(nonce: string): void {
  const navigation = navigations.get(nonce)
  if (navigation?.navigated && !navigation.pending && !navigation.ended && tabDragSession.getSource()?.nonce === nonce) navigation.accepted = true
}
