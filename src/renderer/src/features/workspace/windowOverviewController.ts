import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUiStore } from '../../stores/uiStore'
import { captureWindowPreview } from './windowPreview'
import { flushPanelViewStates } from './panelViewState'
import { useNewTabMenu } from './newTabMenuController'

export async function captureCurrentWindowPreview(expectedKey?: string): Promise<void> {
  const state = useWorkspaceStore.getState()
  flushPanelViewStates()
  const element = document.querySelector<HTMLElement>('.workspace-host')
  const { activeWorkspaceKey, activeWindowId, activeWindowKey } = state
  if (!element || !activeWorkspaceKey || !activeWindowId || state.surface !== 'course' || state.windowsOverviewOpen ||
      (expectedKey !== undefined && activeWindowKey !== expectedKey)) return
  await captureWindowPreview({ workspaceKey: activeWorkspaceKey, windowId: activeWindowId, element,
    isCurrent: () => useWorkspaceStore.getState().activeWindowKey === activeWindowKey &&
      useWorkspaceStore.getState().surface === 'course' && !useWorkspaceStore.getState().windowsOverviewOpen })
}

let toggling = false
export async function toggleWindowOverview(): Promise<void> {
  if (toggling) return
  const state = useWorkspaceStore.getState()
  if (!state.activeWorkspace) return
  if (state.windowsOverviewOpen) { state.setWindowsOverviewOpen(false); return }
  toggling = true
  try {
    const ui = useUiStore.getState()
    ui.closeSettings(); ui.closeBoardOverlay(); ui.closeLinkGraph()
    useNewTabMenu.getState().close()
    if (state.surface !== 'course') state.showWorkspace(state.activeWorkspace)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await captureCurrentWindowPreview()
    if (useWorkspaceStore.getState().activeWindowKey === state.activeWindowKey && useWorkspaceStore.getState().surface === 'course') {
      useWorkspaceStore.getState().setWindowsOverviewOpen(true)
    }
  } finally { toggling = false }
}
