import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react'
import { useCoursesStore } from '../../stores/coursesStore'
import { BANDAL_TAB_DRAG_MIME, matchesWorkspaceMoveData } from '../workspace/tabDrag'
import { tabDragSession } from '../workspace/tabDragSession'
import { navigateWorkspaceCourseHover } from '../workspace/courseTabMoveNavigation'
import { dropWorkspaceTabOnCourse } from '../workspace/workspaceTabDrop'

export const WORKSPACE_COURSE_HOVER_MS = 300

/** Folder rows switch the canvas while the held tab stays in its source. */
export function useWorkspaceCourseHover(): { rowProps(courseId: string, enabled: boolean): HTMLAttributes<HTMLDivElement> } {
  const [hovered, setHovered] = useState<string | null>(null)
  const pending = useRef<{ courseId: string; nonce: string; element: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null)
  const enabledCourses = useRef(new Map<string, boolean>())
  const clear = useCallback((): void => {
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = null
    setHovered(null)
  }, [])
  useEffect(() => {
    const unsubscribe = tabDragSession.subscribe(() => {
      if (pending.current && pending.current.nonce !== tabDragSession.getSource()?.nonce) clear()
    })
    const elsewhere = (event: DragEvent): void => {
      if (pending.current && event.target instanceof Node && !pending.current.element.contains(event.target)) clear()
    }
    // Native DnD can omit a row's final dragleave when its content changes.
    // The next actual target cancels that timer before it can switch courses.
    window.addEventListener('dragover', elsewhere, true)
    return () => { unsubscribe(); window.removeEventListener('dragover', elsewhere, true); if (pending.current) clearTimeout(pending.current.timer) }
  }, [clear])
  return { rowProps: (courseId, enabled) => {
    enabledCourses.current.set(courseId, enabled)
    return {
    'data-tab-hover': hovered === courseId || undefined,
    onDragOver: event => {
      const source = tabDragSession.getSource()
      if (!enabled || !source || tabDragSession.getSnapshot() !== 'tab' || !event.dataTransfer.types.includes(BANDAL_TAB_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (useCoursesStore.getState().selectedCourseId === courseId) { clear(); return }
      if (pending.current?.courseId === courseId) return
      clear()
      setHovered(courseId)
      pending.current = { courseId, nonce: source.nonce, element: event.currentTarget, timer: setTimeout(() => {
        clear()
        const courses = useCoursesStore.getState()
        if (tabDragSession.getSource()?.nonce === source.nonce && enabledCourses.current.get(courseId) &&
          courses.courses.some(course => course.id === courseId) && courses.selectedCourseId !== courseId) navigateWorkspaceCourseHover(source.nonce, courseId)
      }, WORKSPACE_COURSE_HOVER_MS) }
    },
    onDragLeave: event => {
      if (pending.current?.courseId !== courseId) return
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom && bounds.width > 0 && bounds.height > 0) return
      clear()
    },
    onDrop: event => {
      const source = tabDragSession.getSource()
      if (!enabled || !source || tabDragSession.getSnapshot() !== 'tab' || !event.dataTransfer.types.includes(BANDAL_TAB_DRAG_MIME) ||
        !matchesWorkspaceMoveData(event.dataTransfer, source)) return
      event.preventDefault()
      event.stopPropagation()
      clear()
      void dropWorkspaceTabOnCourse(source, courseId)
    }
    } as HTMLAttributes<HTMLDivElement>
  } }
}
