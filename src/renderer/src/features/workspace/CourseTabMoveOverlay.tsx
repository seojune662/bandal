import { useEffect, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview'
import { moveWorkspacePanel, useWorkspaceStore, workspaceApiForCourse, type WorkspacePanelMovePosition } from '../../stores/workspaceStore'
import { BANDAL_TAB_DRAG_MIME, matchesWorkspaceMoveData } from './tabDrag'
import { tabDragSession } from './tabDragSession'

interface MoveTarget {
  position: WorkspacePanelMovePosition | undefined
  x: number; y: number; width: number; height: number
  label: string
}

/** Geometry uses public groups and DOM slots, never Dockview's private DnD data. */
export function courseMoveTarget(api: DockviewApi, root: HTMLElement, x: number, y: number): MoveTarget | null {
  const bounds = root.getBoundingClientRect()
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
  const relative = (rect: { left: number; top: number; width: number; height: number }, position: MoveTarget['position'], label: string): MoveTarget => ({
    x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height, position, label
  })
  if (api.panels.length === 0) return relative(bounds, undefined, '이 과목으로 창 옮기기')
  for (const group of api.groups) {
    const rect = group.element.getBoundingClientRect()
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
    const header = group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container')
    const headerRect = header?.getBoundingClientRect()
    if (headerRect && y <= headerRect.bottom) {
      const tabs = [...group.element.querySelectorAll<HTMLElement>('.dv-tabs-container .dv-tab')]
      const next = tabs.findIndex(tab => { const box = tab.getBoundingClientRect(); return x < box.left + box.width / 2 })
      const index = next < 0 ? group.panels.length : next
      const edge = tabs[index]?.getBoundingClientRect().left ?? tabs.at(-1)?.getBoundingClientRect().right ?? headerRect.left
      return relative({ left: edge - 2, top: headerRect.top, width: 4, height: headerRect.height }, { groupId: group.id, direction: 'within', index }, '')
    }
    const content = group.element.querySelector<HTMLElement>('.dv-content-container')?.getBoundingClientRect() ?? rect
    const distance = [x - content.left, content.right - x, y - content.top, content.bottom - y]
    const nearest = distance.indexOf(Math.min(...distance))
    const directions = ['left', 'right', 'above', 'below'] as const
    if (distance[nearest]! >= 0 && distance[nearest]! <= 36) {
      const direction = directions[nearest]!
      const split = { left: content.left, top: content.top, width: content.width, height: content.height }
      if (nearest < 2) { split.width /= 2; if (nearest === 1) split.left += split.width }
      else { split.height /= 2; if (nearest === 3) split.top += split.height }
      return relative(split, { groupId: group.id, direction }, '여기에 나누어 놓기')
    }
    return relative(content, { groupId: group.id, direction: 'within' }, '이 과목으로 창 옮기기')
  }
  return null
}

export function CourseTabMoveOverlay(): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<MoveTarget | null>(null)
  useEffect(() => {
    const root = overlayRef.current?.closest<HTMLElement>('.workspace-host')
    if (!root) return
    const targetAt = (event: DragEvent): { courseId: string; target: MoveTarget } | null => {
      const source = tabDragSession.getSource(), state = useWorkspaceStore.getState()
      if (!source || !event.dataTransfer?.types.includes(BANDAL_TAB_DRAG_MIME) ||
        state.surface !== 'course' || !state.activeCourseId || state.activeCourseId === source.courseId || state.hydration !== 'ready') return null
      const api = workspaceApiForCourse(state.activeCourseId)
      const target = api ? courseMoveTarget(api, root, event.clientX, event.clientY) : null
      return target ? { courseId: state.activeCourseId, target } : null
    }
    const over = (event: DragEvent): void => {
      const destination = targetAt(event)
      if (!destination) { setPreview(null); return }
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer!.dropEffect = 'move'
      setPreview(current => JSON.stringify(current) === JSON.stringify(destination.target) ? current : destination.target)
    }
    const drop = (event: DragEvent): void => {
      const source = tabDragSession.getSource(), destination = targetAt(event)
      if (!source || !destination || !event.dataTransfer || !matchesWorkspaceMoveData(event.dataTransfer, source)) return
      event.preventDefault()
      event.stopPropagation()
      const { courseId: targetCourseId, target } = destination
      void moveWorkspacePanel({ sourceCourseId: source.courseId, panelId: source.panelId, targetCourseId, ...(target.position ? { position: target.position } : {}) })
      setPreview(null)
    }
    const leave = (event: DragEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) setPreview(null)
    }
    const unsubscribe = tabDragSession.subscribe(() => { if (!tabDragSession.getSource()) setPreview(null) })
    root.addEventListener('dragover', over, true)
    root.addEventListener('drop', drop, true)
    root.addEventListener('dragleave', leave)
    return () => { unsubscribe(); root.removeEventListener('dragover', over, true); root.removeEventListener('drop', drop, true); root.removeEventListener('dragleave', leave) }
  }, [])
  return <div className="course-tab-move-overlay" ref={overlayRef} aria-hidden="true">
    {preview && <div className="course-tab-move-preview" style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}><span>{preview.label}</span></div>}
  </div>
}
