import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../../shared/tabs'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { ChatSurface } from './ChatSurface'

function descriptorFromParams(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) {
    return null
  }
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

export default function ChatTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)
  if (descriptor === null || descriptor.kind !== 'chat') {
    return <div className="chat-tab" data-kind="unknown" />
  }
  return (
    <ChatSurface courseId={descriptor.payload.courseId} variant="tab" />
  )
}
