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
import { BrowserPanel, PlaceholderPanel } from './panels/PlaceholderPanel'
import NoteTab from '../notes/NoteTab'

export interface TabRegistryEntry {
  component: FunctionComponent<IDockviewPanelProps>
  /** Shared-icon name when one exists; workspaceIcons covers the rest. */
  icon: IconName | null
  defaultTitle: (descriptor: TabDescriptor) => string
  /** 'global' = one per window, 'course' = one per course. */
  singleton?: 'global' | 'course'
}

export const tabRegistry: Record<TabKind, TabRegistryEntry> = {
  pdf: {
    component: PlaceholderPanel, // M3-D: replace with the real PdfViewer
    icon: 'filePdf',
    defaultTitle: tabTitle
  },
  note: {
    component: NoteTab,
    icon: 'fileText',
    defaultTitle: tabTitle
  },
  browser: {
    component: BrowserPanel, // M3-F: attach the webview guest to the anchor
    icon: null,
    defaultTitle: tabTitle
  },
  chat: {
    component: PlaceholderPanel, // M4: replace with the chat surface
    icon: null,
    defaultTitle: tabTitle,
    singleton: 'course'
  },
  board: {
    component: PlaceholderPanel, // M5: replace with the board
    icon: null,
    defaultTitle: tabTitle,
    singleton: 'global'
  }
}

/** Component map in the shape DockviewReact wants (keyed by TabKind). */
export const dockviewComponents: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = Object.fromEntries(
  Object.entries(tabRegistry).map(([kind, entry]) => [kind, entry.component])
)
