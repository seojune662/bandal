function record(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** Changes view identities without changing documents or the split tree. */
export function remapWorkspacePanelIds(raw: unknown, nextId: (id: string, panel: Record<string, any>) => string): { layout: unknown; changed: boolean } {
  if (!record(raw) || !record(raw.panels) || !record(raw.grid)) return { layout: raw, changed: false }
  const ids = new Map<string, string>()
  for (const [id, panel] of Object.entries(raw.panels)) if (record(panel)) {
    const next = nextId(id, panel)
    if (next !== id) ids.set(id, next)
  }
  if (!ids.size) return { layout: raw, changed: false }
  const layout = structuredClone(raw)
  layout.panels = Object.fromEntries(Object.entries(layout.panels).map(([id, panel]) => {
    const next = ids.get(id) ?? id
    return [next, { ...(panel as object), id: next }]
  }))
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
