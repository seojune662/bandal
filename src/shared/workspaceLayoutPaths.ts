import { isTabDescriptor, type TabDescriptor } from './tabs'

function record(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
interface Move { courseId: string; fromRelPath: string; toRelPath: string; isDirectory: boolean }
/** Rewrites both persisted resource addresses and every Dockview reference atomically. */
export function rewriteWorkspaceLayoutPaths(raw: unknown, move: Move): { layout: unknown; changed: boolean } {
  if (!record(raw) || !record(raw.panels) || !record(raw.grid)) return { layout: raw, changed: false }
  const nextPath = (path: string): string => path === move.fromRelPath || move.isDirectory && path.startsWith(`${move.fromRelPath}/`) ? `${move.toRelPath}${path.slice(move.fromRelPath.length)}` : path
  const layout = structuredClone(raw), ids = new Map<string, string>()
  for (const [oldId, value] of Object.entries(layout.panels)) {
    if (!record(value) || !isTabDescriptor(value.params?.descriptor)) continue
    const original = value.params.descriptor as TabDescriptor
    if (!('courseId' in original.payload) || original.payload.courseId !== move.courseId) continue
    const descriptor = structuredClone(original)
    let id: string | null = null
    if ((descriptor.kind === 'learning' || descriptor.kind === 'learning-resource') && descriptor.payload.rootRelPath !== undefined) {
      const root = nextPath(descriptor.payload.rootRelPath)
      if (root === descriptor.payload.rootRelPath) continue
      descriptor.payload.rootRelPath = root
      id = descriptor.kind === 'learning' ? `learning:${move.courseId}:project:${root}`
        : `learning-resource:${JSON.stringify([move.courseId, root, descriptor.payload.resource.kind, 'id' in descriptor.payload.resource ? descriptor.payload.resource.id : null])}`
    } else if ('relPath' in descriptor.payload) {
      const path = nextPath(descriptor.payload.relPath)
      if (path === descriptor.payload.relPath) continue
      descriptor.payload.relPath = path
      id = `${descriptor.kind}:${move.courseId}:${path}`
    }
    if (id === null) continue
    const duplicate = oldId.indexOf('::duplicate::')
    if (duplicate !== -1) id += oldId.slice(duplicate)
    if (layout.panels[id] && id !== oldId) id += `::duplicate::moved-${encodeURIComponent(oldId)}`
    delete layout.panels[oldId]
    layout.panels[id] = { ...value, id, params: { ...value.params, descriptor } }
    ids.set(oldId, id)
  }
  if (!ids.size) return { layout: raw, changed: false }
  const visit = (node: any): void => {
    if (!record(node)) return
    if (Array.isArray(node.data)) { node.data.forEach(visit); return }
    if (!record(node.data) || !Array.isArray(node.data.views)) return
    node.data.views = node.data.views.map((id: string) => ids.get(id) ?? id)
    if (node.data.activeView) node.data.activeView = ids.get(node.data.activeView) ?? node.data.activeView
  }
  visit(layout.grid.root)
  return { layout, changed: true }
}
