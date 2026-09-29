/** Ownership follows the initiating tab, including nested site windows. */
export interface BrowsingContext {
  rootId: number
  tabId: string | null
  courseId: string | null
}

const contexts = new Map<number, BrowsingContext>()

export function registerBrowsingContext(id: number, parentId?: number): void {
  contexts.set(id, (parentId === undefined ? undefined : contexts.get(parentId)) ?? {
    rootId: id, tabId: null, courseId: null
  })
}

export function browsingContext(id: number | null): BrowsingContext | undefined {
  return id === null ? undefined : contexts.get(id)
}

export function setBrowsingCourse(id: number, tabId: string, courseId: string | null): void {
  const context = contexts.get(id)
  if (!context || context.rootId !== id) throw new Error('브라우저 탭을 찾지 못했어요.')
  context.tabId = tabId
  context.courseId = courseId
}

export function forgetBrowsingContext(id: number): void {
  contexts.delete(id)
}
