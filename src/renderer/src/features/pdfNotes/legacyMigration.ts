import { invoke } from '../../lib/ipc'
import type { IpcResponse } from '../../../../shared/ipc/contract'
const running = new Map<string, Promise<IpcResponse<'pdfNotes:migrateLegacy'>>>()
export function migrateCourseNotes(courseId: string): Promise<IpcResponse<'pdfNotes:migrateLegacy'>> {
  const pending = running.get(courseId)
  if (pending) return pending
  const next = invoke('pdfNotes:migrateLegacy', { courseId }).finally(() => running.delete(courseId))
  running.set(courseId, next)
  return next
}
