import type { TabDescriptor } from '../../../../shared/tabs'
import { tabPanelId } from './tabIdentity'

type CloseGuard = (descriptor: TabDescriptor) => boolean | Promise<boolean>
let guard: CloseGuard | null = null
const resources = new Map<string, Set<() => Promise<boolean>>>()

/** Independent resource views must finish pending writes before their pane closes. */
export function registerResourceCloseGuard(descriptor: TabDescriptor, check: () => Promise<boolean>): () => void {
  const key = tabPanelId(descriptor)
  const checks = resources.get(key) ?? new Set()
  checks.add(check); resources.set(key, checks)
  return () => { checks.delete(check); if (!checks.size) resources.delete(key) }
}

/** Native browser pages can veto a user close through their beforeunload flow. */
export function registerTabCloseGuard(next: CloseGuard): () => void {
  guard = next
  return () => {
    if (guard === next) guard = null
  }
}

export function canCloseTab(
  descriptor: TabDescriptor
): boolean | Promise<boolean> {
  const checks = resources.get(tabPanelId(descriptor))
  const native = guard?.(descriptor) ?? true
  if (!checks?.size) return native
  return Promise.resolve(native).then(async allowed => {
    if (!allowed) return false
    for (const check of checks) if (!await check()) return false
    return true
  })
}
