import { useEffect, useState } from 'react'
import { onPush } from '../../lib/ipc'
import { AgentToolActivity } from './AgentToolCards'
import { useAgentToolActivity } from './agentToolActivityStore'
import './chat.css'
import './chat-blocks.css'
import './chat-refresh.css'
function Requests({ id }: { id: string }): JSX.Element {
  const activity = useAgentToolActivity(id)
  const pending = activity.items.filter(item => item.kind === 'confirmation' && item.response === null)
  return <aside className="approval-companion" aria-label="승인 요청">
    <div className="approval-companion__heading">확인이 필요해요 <small>{pending.length > 1 ? `${pending.length}개 대기` : ''}</small></div>
    <AgentToolActivity items={pending.slice(0, 1)} onRespondConfirm={activity.respondConfirm} onUndoTurn={activity.undoTurn} shouldAutoFocusReject={() => false} />
  </aside>
}
export function ApprovalApp(): JSX.Element {
  const [id, setId] = useState(new URLSearchParams(location.search).get('conversationId') ?? '')
  useEffect(() => onPush('assistant:approval', event => setId(event.conversationId)), [])
  return id ? <Requests id={id} /> : <></>
}
