import { isTabDescriptor, type TabDescriptor } from '../../../../shared/tabs'
import type { LearningBinding, LearningProjectSnapshot } from '../../../../shared/types/learning'
import { invoke } from '../../lib/ipc'
import { tabPanelId } from './tabIdentity'

function record(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** Upgrade saved mutable learning screens before strict panel-identity validation. */
export async function migrateLearningLayout(raw: unknown, readProject: (binding: LearningBinding) => Promise<LearningProjectSnapshot> = binding => invoke('learning:get', { binding })): Promise<{ layout: unknown; changed: boolean }> {
  if (!record(raw) || !record(raw.panels) || !record(raw.grid)) return { layout: raw, changed: false }
  const candidates = Object.entries(raw.panels).filter(([, panel]) => record(panel) && isTabDescriptor(panel.params?.descriptor) && panel.params.descriptor.kind === 'learning')
  if (!candidates.length) return { layout: raw, changed: false }
  const layout = structuredClone(raw)
  const ids = new Map<string, string | null>()
  const reads = new Map<string, Promise<LearningProjectSnapshot>>()
  for (const [oldId, oldPanel] of candidates) {
    const panel = oldPanel as Record<string, any>
    const descriptor = panel.params.descriptor as Extract<TabDescriptor, { kind: 'learning' }>
    const payload = descriptor.payload
    let next: TabDescriptor | null = null
    if (payload.rootRelPath !== undefined) {
      const base = { courseId: payload.courseId, rootRelPath: payload.rootRelPath, ...(payload.projectId ? { projectId: payload.projectId } : {}) }
      if (payload.view === 'vocabulary') next = { kind: 'learning-resource', payload: { ...base, resource: { kind: 'vocabulary' } } }
      else if (payload.view === 'review' && payload.itemId) next = { kind: 'learning-resource', payload: { ...base, resource: { kind: 'artifact', id: payload.itemId } } }
      else if (payload.view === 'reader') {
        let id = payload.itemId
        if (!id) {
          const key = JSON.stringify([payload.courseId, payload.rootRelPath])
          if (!reads.has(key)) reads.set(key, readProject(base))
          const project = await reads.get(key)!
          id = project.articles.find(item => item.status === 'reading')?.id ?? project.articles.find(item => item.status === 'unread')?.id ?? project.articles.at(-1)?.id
        }
        if (id) next = { kind: 'learning-resource', payload: { ...base, resource: { kind: 'article', id } } }
      }
    }
    delete layout.panels[oldId]
    if (next) {
      let id = tabPanelId(next)
      const duplicate = oldId.indexOf('::duplicate::')
      if (duplicate !== -1) id += oldId.slice(duplicate)
      if (layout.panels[id]) id += `::duplicate::legacy-${encodeURIComponent(oldId)}`
      ids.set(oldId, id)
      layout.panels[id] = { ...panel, id, contentComponent: next.kind, params: { ...panel.params, descriptor: next } }
    } else ids.set(oldId, null)
  }
  const visit = (node: any): void => {
    if (!record(node)) return
    if (Array.isArray(node.data)) { node.data.forEach(visit); return }
    if (!record(node.data) || !Array.isArray(node.data.views)) return
    node.data.views = node.data.views.flatMap((id: string) => ids.has(id) ? ids.get(id) ? [ids.get(id)] : [] : [id])
    const active = ids.has(node.data.activeView) ? ids.get(node.data.activeView) : node.data.activeView
    if (active && node.data.views.includes(active)) node.data.activeView = active
    else if (node.data.views.length) node.data.activeView = node.data.views[0]
    else delete node.data.activeView
  }
  visit(layout.grid.root)
  return { layout, changed: true }
}
