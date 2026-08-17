/**
 * M2 placeholder panels — one per TabKind until the feature milestones land
 * their real components (registered in tabRegistry.tsx).
 */

import { useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../../../shared/tabs'
import { isTabDescriptor, tabPayloadSummary, tabTitle } from '../tabIdentity'
import { TabKindIcon } from '../workspaceIcons'
import { useBrowserAnchorRect } from './browserAnchor'

export interface WorkspacePanelParams {
  descriptor: TabDescriptor
  [key: string]: unknown
}

const KIND_LABEL: Record<TabDescriptor['kind'], string> = {
  pdf: 'PDF 뷰어',
  note: '필기',
  browser: '브라우저',
  chat: 'AI 튜터',
  board: '학업 보드',
  'group-chat': '그룹 채팅',
  image: '이미지',
  file: '문서 뷰어',
  whiteboard: '화이트보드'
}

function PanelBody({ descriptor }: { descriptor: TabDescriptor }): JSX.Element {
  return (
    <div className="workspace-panel__body">
      <span className="workspace-panel__glyph" data-kind={descriptor.kind}>
        <TabKindIcon kind={descriptor.kind} />
      </span>
      <p className="workspace-panel__eyebrow">{KIND_LABEL[descriptor.kind]}</p>
      <h2 className="workspace-panel__title">{tabTitle(descriptor)}</h2>
      <p className="workspace-panel__summary">{tabPayloadSummary(descriptor)}</p>
      <span className="workspace-panel__badge">곧 제공됩니다</span>
    </div>
  )
}

function descriptorFromParams(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) return null
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

/** Generic placeholder for pdf / note / chat / board. */
export function PlaceholderPanel(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)
  if (descriptor === null) {
    return <div className="workspace-panel" data-kind="unknown" />
  }
  return (
    <div className="workspace-panel" data-kind={descriptor.kind}>
      <PanelBody descriptor={descriptor} />
    </div>
  )
}

/**
 * Browser placeholder. Renders the stable anchor container the real
 * `<webview>` guest will be positioned over in M3-F — see
 * ./browserAnchor.ts for the full lifecycle contract (unmount hides the
 * guest; it never destroys it).
 */
export function BrowserPanel(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)
  const anchorRef = useRef<HTMLDivElement>(null)
  const tabId =
    descriptor !== null && descriptor.kind === 'browser'
      ? descriptor.payload.tabId
      : ''
  useBrowserAnchorRect(tabId, anchorRef)

  if (descriptor === null || descriptor.kind !== 'browser') {
    return <div className="workspace-panel" data-kind="unknown" />
  }
  return (
    <div className="workspace-panel" data-kind="browser">
      <div
        ref={anchorRef}
        className="workspace-panel__browser-anchor"
        data-browser-anchor={descriptor.payload.tabId}
      >
        <PanelBody descriptor={descriptor} />
      </div>
    </div>
  )
}
