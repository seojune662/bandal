import { v4 as uuidv4 } from 'uuid'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useBrowserGuests } from '../browser/browserGuestsStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { AI_WEB_SHORTCUTS, findAiShortcutPanel, type AiWebService } from './aiShortcutModel'

/** Opens an AI site, reusing its live tab (conversation URLs included) instead of resetting it. */
export function openAiShortcut(service: AiWebService): void {
  const workspace = useWorkspaceStore.getState()
  const browser = useBrowserGuests.getState()
  const existing = findAiShortcutPanel(service, workspace.openTabs, browser.nav, workspace.activePanelId, browser.liveGuests.map(guest => guest.tabId))
  if (existing !== null) {
    workspace.showWorkspace(workspace.activeWorkspace)
    workspace.activatePanel(existing)
    const descriptor = workspace.openTabs[existing]
    if (descriptor?.kind === 'browser') browser.touchGuest(descriptor.payload.tabId)
    return
  }
  const shortcut = AI_WEB_SHORTCUTS.find(shortcut => shortcut.id === service)!
  workspace.openTab(descriptorFor('browser', { tabId: uuidv4(), initialUrl: shortcut.url, profileId: 'default' }))
}
