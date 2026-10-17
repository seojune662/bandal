/** Page recipes for `pdf:restructure`: one entry per page of the new
 * document, referencing an existing 1-based page (plus an extra rotation) or
 * `null` for a new blank page. Pure, so each helper is trivially testable. */
export interface PageRecipeEntry { source: number | null; rotate?: 0 | 90 | 180 | 270 }
const identity = (count: number): PageRecipeEntry[] => Array.from({ length: count }, (_, index) => ({ source: index + 1 }))

/** Move page `from` so it lands at position `to` (both 1-based, in the current order). */
export function movePage(count: number, from: number, to: number): PageRecipeEntry[] {
  const pages = identity(count)
  const [moved] = pages.splice(from - 1, 1)
  pages.splice(to - 1, 0, moved!)
  return pages
}
export function deletePage(count: number, page: number): PageRecipeEntry[] {
  return identity(count).filter(entry => entry.source !== page)
}
export function duplicatePage(count: number, page: number): PageRecipeEntry[] {
  const pages = identity(count)
  pages.splice(page, 0, { source: page })
  return pages
}
export function rotatePage(count: number, page: number, by: 90 | 180 | 270): PageRecipeEntry[] {
  return identity(count).map(entry => entry.source === page ? { source: page, rotate: by } : entry)
}
/** Insert a blank page so that it becomes page `position` (1-based; count + 1 appends). */
export function insertBlankPage(count: number, position: number): PageRecipeEntry[] {
  const pages = identity(count)
  pages.splice(position - 1, 0, { source: null })
  return pages
}

/** Where a page dropped on insert slot `slot` (1-based; count + 1 = after the
 * last page) lands once it has been removed from its old position, or `null`
 * when the drop would not change the order. */
export function moveTarget(count: number, from: number, slot: number): number | null {
  const clamped = Math.max(1, Math.min(count + 1, slot))
  if (clamped === from || clamped === from + 1) return null
  return clamped > from ? clamped - 1 : clamped
}

/** Page maps from `pdf:restructure`, keyed by document, consumed by the next
 * viewer mount so the reader stays on the same content after an edit. */
const pendingPageMaps = new Map<string, number[][]>()
export function rememberPageMap(courseId: string, relPath: string, pageMap: number[][]): void {
  pendingPageMaps.set(`${courseId}:${relPath}`, pageMap)
}
/** Old page → first new page holding it, else the nearest earlier page that survived. */
export function remapPage(pageMap: number[][], page: number): number {
  for (let candidate = Math.min(page, pageMap.length); candidate >= 1; candidate--) {
    const target = pageMap[candidate - 1]?.[0]
    if (target) return target
  }
  return 1
}
export function takeRemappedAnchor<T extends { anchor?: { page: number; pageOffset: number } }>(courseId: string, relPath: string, entry: T | null): T | null {
  const key = `${courseId}:${relPath}`, pageMap = pendingPageMaps.get(key)
  if (!pageMap) return entry
  pendingPageMaps.delete(key)
  if (!entry?.anchor) return entry
  return { ...entry, anchor: { ...entry.anchor, page: remapPage(pageMap, entry.anchor.page) } }
}
