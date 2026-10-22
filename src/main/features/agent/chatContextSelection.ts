import type { MaterialContext } from '../../../shared/types/chatContext'

/** Undefined supports legacy course lookup; an empty id explicitly means no document. */
export function selectChatContextMaterial(courseId: string, sourcePanelId: string | undefined, fresh: boolean,
  panels: ReadonlyMap<string, MaterialContext>, lastByCourse: ReadonlyMap<string, MaterialContext>): MaterialContext | undefined {
  if (sourcePanelId === '') return undefined
  const candidate = sourcePanelId === undefined ? lastByCourse.get(courseId) : panels.get(sourcePanelId)
  if (!candidate || candidate.unavailable || sourcePanelId !== undefined && !fresh) return undefined
  if (sourcePanelId === undefined && candidate.courseId !== courseId) return undefined
  return { ...candidate }
}
