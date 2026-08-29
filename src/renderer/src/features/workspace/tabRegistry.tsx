/**
 * Tab registry: single place mapping TabKind → panel component + metadata.
 *
 * HOW LATER MILESTONES REGISTER A REAL TAB COMPONENT (M3+):
 *  1. Build a component with the `IDockviewPanelProps` signature that reads
 *     its `TabDescriptor` from `props.params.descriptor`.
 *  2. Replace the `component` import below for your kind. Nothing else
 *     changes — panel ids, dedupe, persistence and the "+" menu all key off
 *     TabKind, not the component.
 *  3. Persisted layouts keep working: `contentComponent` is the kind name.
 *
 * `browser` is special: keep rendering the anchor contract from
 * panels/browserAnchor.ts (the webview guest lives outside the panel DOM).
 */

import type { FunctionComponent } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor, TabKind } from '../../../../shared/tabs'
import type { IconName } from '../../app/icons'
import { tabTitle } from './tabIdentity'
import { PlaceholderPanel } from './panels/PlaceholderPanel'
import { BrowserPanel } from '../browser/BrowserPanel'
import NoteTab from '../notes/NoteTab'
import BoardPanel from '../board/BoardPanel'
import ChatTab from '../chat/ChatTab'
import PdfTab from '../pdf/PdfTab'
import ImageTab from '../image/ImageTab'
import FileTab from '../file/FileTab'
import GroupChatTab from '../group/GroupChatTab'
import CanvasTab from '../canvas/CanvasTab'
import { withMaterialSequence } from '../links/MaterialSequenceWrapper'

export interface TabRegistryEntry {
  component: FunctionComponent<IDockviewPanelProps>
  /** Shared-icon name when one exists; workspaceIcons covers the rest. */
  icon: IconName | null
  defaultTitle: (descriptor: TabDescriptor) => string
}

// `tabPanelId` is the sole dedupe key; registry metadata does not participate
// in deciding whether an existing panel is focused or a new panel is opened.
export const tabRegistry: Record<TabKind, TabRegistryEntry> = {
  pdf: {
    component: PdfTab,
    icon: 'filePdf',
    defaultTitle: tabTitle
  },
  image: {
    component: ImageTab,
    icon: 'fileImage',
    defaultTitle: tabTitle
  },
  file: {
    component: FileTab,
    icon: 'file',
    defaultTitle: tabTitle
  },
  note: {
    component: NoteTab,
    icon: 'fileText',
    defaultTitle: tabTitle
  },
  browser: {
    component: BrowserPanel, // M3-F: real chrome + anchor (guest in BrowserWebviewLayer)
    icon: null,
    defaultTitle: tabTitle
  },
  chat: {
    component: ChatTab,
    icon: null,
    defaultTitle: tabTitle
  },
  board: {
    component: BoardPanel,
    icon: null,
    defaultTitle: tabTitle
  },
  'group-chat': {
    component: GroupChatTab,
    icon: null,
    defaultTitle: tabTitle
  },
  whiteboard: {
    component: CanvasTab,
    icon: null,
    defaultTitle: tabTitle
  }
}

/**
 * Component map in the shape DockviewReact wants (keyed by TabKind).
 * Every panel is wrapped with the material-sequence layer (edge drop zones
 * during a material drag + prev/next nav bar when links exist).
 */
export const dockviewComponents: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = Object.fromEntries(
  Object.entries(tabRegistry).map(([kind, entry]) => [
    kind,
    withMaterialSequence(entry.component)
  ])
)
