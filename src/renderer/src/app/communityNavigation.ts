import { useUiStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

export interface CommunityIntent { compose?: boolean; campaignId?: string; postId?: string }
let pendingIntent: CommunityIntent | null = null

/** Keep links intact while the lazy community screen or account UI loads. */
export function openCommunity(intent?: CommunityIntent): void {
  if (intent) pendingIntent = intent
  const ui = useUiStore.getState()
  ui.closeSettings(); ui.closeBoardOverlay(); ui.closeLinkGraph()
  useUiStore.setState({ leftRailOpen: true })
  useWorkspaceStore.getState().showCommunity()
  window.dispatchEvent(new Event('bandal:community-open'))
}

export function takeCommunityIntent(): CommunityIntent | null {
  const intent = pendingIntent
  pendingIntent = null
  return intent
}
