import type {
  AgentAction,
  AgentConfirmRequest,
  AgentTurnChanges
} from '../../../../shared/types/agentTools'
import type {
  AgentToolActivityItem,
  AgentUndoState
} from './agentToolActivityStore'

export function agentConfirmResponseLabel(approved: boolean): string {
  return approved ? '승인함' : '거부함'
}

export function agentActionUndoLabel(action: AgentAction): string | null {
  if (!action.undoable) {
    return '되돌릴 수 없음'
  }
  return action.undoneAt === null ? null : '되돌림'
}

export function agentTurnUndoButtonLabel(
  actions: readonly AgentAction[],
  undoState: AgentUndoState
): string {
  if (undoState === 'pending') {
    return '되돌리는 중…'
  }
  if (undoState === 'error') {
    return '되돌리기 다시 시도'
  }
  if (actions.some((action) => action.undoable && action.undoneAt === null)) {
    return '되돌리기'
  }
  return actions.some((action) => action.undoable)
    ? '되돌림'
    : '되돌릴 항목 없음'
}

export interface AgentConfirmCardProps {
  request: AgentConfirmRequest
  response: boolean | null
  isResponding?: boolean
  hasResponseError?: boolean
  autoFocusReject?: boolean
  onRespond: (requestId: string, approved: boolean) => void
}

export function AgentConfirmCard({
  request,
  response,
  isResponding = false,
  hasResponseError = false,
  autoFocusReject = true,
  onRespond
}: AgentConfirmCardProps): JSX.Element {
  const isPending = response === null

  return (
    <article
      className="chat-agent-confirm"
      aria-label="파괴적 변경 확인"
      data-resolved={isPending ? undefined : true}
    >
      <header className="chat-agent-confirm__header">
        <div className="chat-agent-confirm__heading">
          <span className="chat-agent-confirm__eyebrow">
            파괴적 변경 확인
          </span>
          <h3 className="chat-agent-confirm__summary">{request.summary}</h3>
        </div>
        {!isPending && (
          <span
            className="chat-agent-confirm__badge"
            data-approved={response}
          >
            {agentConfirmResponseLabel(response)}
          </span>
        )}
      </header>

      {request.details.length > 0 && (
        <ul className="chat-agent-confirm__details">
          {request.details.map((detail, index) => (
            <li key={`${detail}:${index}`}>{detail}</li>
          ))}
        </ul>
      )}

      <div className="chat-agent-confirm__meta">
        <span>실행할 도구</span>
        <code>{request.tool}</code>
      </div>

      {isPending && (
        <>
          {isResponding && (
            <p className="chat-agent-confirm__notice" role="status">
              응답을 보내는 중…
            </p>
          )}
          {hasResponseError && (
            <p className="chat-agent-confirm__error" role="alert">
              응답을 보내지 못했어요. 다시 선택해 주세요.
            </p>
          )}
          <div className="chat-agent-confirm__actions">
            <button
              type="button"
              className="chat-agent-confirm__button chat-agent-confirm__button--reject"
              autoFocus={autoFocusReject}
              disabled={isResponding}
              onClick={() => onRespond(request.requestId, false)}
            >
              거부
            </button>
            <button
              type="button"
              className="chat-agent-confirm__button chat-agent-confirm__button--approve"
              disabled={isResponding}
              onClick={() => onRespond(request.requestId, true)}
            >
              승인
            </button>
          </div>
        </>
      )}
    </article>
  )
}

export interface AgentTurnChangesCardProps {
  changes: AgentTurnChanges
  undoState?: AgentUndoState
  onUndo: (turnId: string) => void
}

export function AgentTurnChangesCard({
  changes,
  undoState = 'idle',
  onUndo
}: AgentTurnChangesCardProps): JSX.Element | null {
  if (changes.actions.length === 0) {
    return null
  }

  const canUndo = changes.actions.some(
    (action) => action.undoable && action.undoneAt === null
  )
  const hasUndoneAction = changes.actions.some(
    (action) => action.undoable && action.undoneAt !== null
  )

  return (
    <article className="chat-turn-changes" aria-label="이번에 바꾼 것">
      <header className="chat-turn-changes__header">
        <h3>이번에 바꾼 것</h3>
        <span>{changes.actions.length}개</span>
      </header>

      <ul className="chat-turn-changes__list">
        {changes.actions.map((action) => {
          const undoLabel = agentActionUndoLabel(action)
          return (
            <li key={action.id} className="chat-turn-changes__item">
              <span className="chat-turn-changes__label">{action.label}</span>
              {undoLabel !== null && (
                <span
                  className="chat-turn-changes__status"
                  data-undoable={action.undoable}
                >
                  {undoLabel}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {(undoState === 'complete' || (!canUndo && hasUndoneAction)) && (
        <p className="chat-turn-changes__notice" role="status">
          되돌릴 수 있는 변경을 되돌렸어요.
        </p>
      )}
      {undoState === 'error' && (
        <p className="chat-turn-changes__error" role="alert">
          변경을 되돌리지 못했어요.
        </p>
      )}

      <div className="chat-turn-changes__actions">
        <button
          type="button"
          className="chat-turn-changes__undo"
          disabled={undoState === 'pending' || !canUndo}
          onClick={() => onUndo(changes.turnId)}
        >
          {agentTurnUndoButtonLabel(changes.actions, undoState)}
        </button>
      </div>
    </article>
  )
}

export interface AgentToolActivityProps {
  items: readonly AgentToolActivityItem[]
  onRespondConfirm: (requestId: string, approved: boolean) => void
  onUndoTurn: (turnId: string) => void
}

function activeConfirmationId(
  items: readonly AgentToolActivityItem[]
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === 'confirmation' && item.response === null) {
      return item.request.requestId
    }
  }
  return null
}

export function AgentToolActivity({
  items,
  onRespondConfirm,
  onUndoTurn
}: AgentToolActivityProps): JSX.Element {
  const activeRequestId = activeConfirmationId(items)

  return (
    <>
      {items.map((item) =>
        item.kind === 'confirmation' ? (
          <AgentConfirmCard
            key={`confirmation:${item.request.requestId}`}
            request={item.request}
            response={item.response}
            isResponding={item.isResponding}
            hasResponseError={item.hasResponseError}
            autoFocusReject={item.request.requestId === activeRequestId}
            onRespond={onRespondConfirm}
          />
        ) : (
          <AgentTurnChangesCard
            key={`changes:${item.turnId}`}
            changes={{ turnId: item.turnId, actions: item.actions }}
            undoState={item.undoState}
            onUndo={onUndoTurn}
          />
        )
      )}
    </>
  )
}
