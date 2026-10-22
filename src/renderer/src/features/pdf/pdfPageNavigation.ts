export interface PdfPageNavigationTarget {
  courseId: string
  relPath: string
  page: number
  /** An explicit source reference navigates only its original document pane. */
  panelId?: string
}

export const PDF_PAGE_NAVIGATION_EVENT = 'bandal:pdf-page-navigation'

const pendingPages = new Map<string, number>()

function targetKey(courseId: string, relPath: string, panelId?: string): string {
  return JSON.stringify([courseId, relPath, panelId ?? null])
}

export function requestPdfPageNavigation(target: PdfPageNavigationTarget): void {
  pendingPages.set(targetKey(target.courseId, target.relPath, target.panelId), target.page)
  window.dispatchEvent(new CustomEvent(PDF_PAGE_NAVIGATION_EVENT, { detail: target }))
}

export function takePdfPageNavigation(
  courseId: string,
  relPath: string,
  panelId?: string
): number | null {
  const exact = targetKey(courseId, relPath, panelId)
  const key = pendingPages.has(exact) ? exact : targetKey(courseId, relPath)
  const page = pendingPages.get(key)
  if (page === undefined) return null
  pendingPages.delete(key)
  return page
}
