/** Windows are presentation canvases inside one course/project workspace. */
import type { WorkspaceRef } from './types/workspace'

export interface WorkspaceWindowRef { workspace: WorkspaceRef; windowId: string }
export const DEFAULT_WORKSPACE_WINDOW_ID = 'main'
export type WorkspaceChromeMode = 'all' | 'tabs-hidden' | 'all-hidden'
export interface WorkspaceWindowInfo { id: string; name: string; chromeMode: WorkspaceChromeMode }
export interface WorkspaceWindow extends WorkspaceWindowInfo { layout: unknown }
export interface WorkspaceWindows {
  kind: 'workspace-windows'
  version: 1
  activeWindowId: string
  windows: WorkspaceWindow[]
}

export function workspaceWindowKey(workspaceKey: string, windowId = DEFAULT_WORKSPACE_WINDOW_ID): string {
  return windowId === DEFAULT_WORKSPACE_WINDOW_ID ? workspaceKey : `window:${JSON.stringify([workspaceKey, windowId])}`
}
export function workspaceWindowFromKey(key: string): { workspaceKey: string; windowId: string } {
  if (key.startsWith('window:[')) {
    try {
      const value: unknown = JSON.parse(key.slice('window:'.length))
      if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string' && item.length > 0)) {
        return { workspaceKey: value[0], windowId: value[1] }
      }
    } catch { /* Ordinary course keys remain valid. */ }
  }
  return { workspaceKey: key, windowId: DEFAULT_WORKSPACE_WINDOW_ID }
}
export function isWorkspaceWindows(raw: unknown): raw is WorkspaceWindows {
  return typeof raw === 'object' && raw !== null && (raw as WorkspaceWindows).kind === 'workspace-windows'
}
/** A malformed envelope must never silently overwrite previously saved windows. */
export function readWorkspaceWindows(raw: unknown): WorkspaceWindows {
  if (!isWorkspaceWindows(raw)) return { kind: 'workspace-windows', version: 1, activeWindowId: DEFAULT_WORKSPACE_WINDOW_ID,
    windows: [{ id: DEFAULT_WORKSPACE_WINDOW_ID, name: '윈도우 1', chromeMode: 'all', layout: raw }] }
  if (raw.version !== 1 || !Array.isArray(raw.windows) || !raw.windows.length || raw.windows.some(window =>
    !window || typeof window.id !== 'string' || !window.id || typeof window.name !== 'string' ||
    !['all', 'tabs-hidden', 'all-hidden'].includes(window.chromeMode)) || new Set(raw.windows.map(window => window.id)).size !== raw.windows.length) {
    throw new Error('저장된 윈도우를 읽지 못했습니다. 원본은 보존되어 있어요.')
  }
  return { ...raw, activeWindowId: raw.windows.some(window => window.id === raw.activeWindowId) ? raw.activeWindowId : raw.windows[0]!.id,
    windows: raw.windows.map(window => ({ ...window })) }
}
/** Apply resource-path migrations to every canvas, preserving window metadata. */
export function mapWorkspaceWindowLayouts(raw: unknown, map: (layout: unknown) => unknown): unknown {
  return isWorkspaceWindows(raw) ? { ...raw, windows: readWorkspaceWindows(raw).windows.map(window => ({ ...window, layout: map(window.layout) })) } : map(raw)
}
