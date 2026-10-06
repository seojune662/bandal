import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import { useCoursesStore } from '../../stores/coursesStore'
import { BANDAL_TAB_DRAG_MIME } from '../workspace/tabDrag'
import { tabDragSession } from '../workspace/tabDragSession'

export const WORKSPACE_COURSE_HOVER_MS = 450

/** Folder rows switch the canvas while the held tab stays in its source. */
export function useWorkspaceCourseHover(): { rowProps(courseId: string, enabled: boolean): HTMLAttributes<HTMLDivElement> } {
  const [hovered, setHovered] = useState<string | null>(null)
  const pending = useRef<{ courseId: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const clear = (): void => {
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = null
    setHovered(null)
  }
  useEffect(() => {
    const unsubscribe = tabDragSession.subscribe(() => { if (!tabDragSession.getSource()) clear() })
    return () => { unsubscribe(); if (pending.current) clearTimeout(pending.current.timer) }
  }, [])
  return { rowProps: (courseId, enabled) => ({
    'data-tab-hover': hovered === courseId || undefined,
    onDragOver: event => {
      if (!enabled || !tabDragSession.getSource() || !event.dataTransfer.types.includes(BANDAL_TAB_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      if (pending.current?.courseId === courseId || hovered === courseId) return
      clear()
      setHovered(courseId)
      pending.current = { courseId, timer: setTimeout(() => {
        pending.current = null
        if (tabDragSession.getSource()) useCoursesStore.getState().selectCourse(courseId)
      }, WORKSPACE_COURSE_HOVER_MS) }
    },
    onDragLeave: event => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom && bounds.width > 0 && bounds.height > 0) return
      clear()
    },
    onDrop: event => {
      if (!tabDragSession.getSource() || !event.dataTransfer.types.includes(BANDAL_TAB_DRAG_MIME)) return
      // A folder is a hover destination, not the final placement target.
      event.preventDefault()
      event.stopPropagation()
      clear()
    }
  } as HTMLAttributes<HTMLDivElement>) }
}
