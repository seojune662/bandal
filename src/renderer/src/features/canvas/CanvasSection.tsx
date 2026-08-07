import { useCallback, useEffect, useRef, useState } from 'react'
import type { PersonalBoard } from '../../../../shared/types/whiteboard'
import { Icon } from '../../app/icons'
import { invoke } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import './canvas.css'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function sortBoards(boards: readonly PersonalBoard[]): PersonalBoard[] {
  return [...boards].sort(
    (left, right) => left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt)
  )
}

export function CanvasSection(props: { courseId: string }): JSX.Element | null {
  const { courseId } = props
  const [boards, setBoards] = useState<PersonalBoard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const cancelledRenameRef = useRef(false)

  const openBoard = useCallback((boardId: string): void => {
    useWorkspaceStore.getState().openTab(
      descriptorFor('whiteboard', { courseId, boardId })
    )
  }, [courseId])

  useEffect(() => {
    let cancelled = false
    setBoards(null)
    setError(null)
    setEditingId(null)
    void invoke('canvas:list', { courseId }).then((result) => {
      if (!cancelled) setBoards(sortBoards(result))
    }).catch((loadError: unknown) => {
      if (!cancelled) {
        setBoards([])
        setError(errorMessage(loadError, '화이트보드 목록을 불러오지 못했어요.'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [courseId])

  const createBoard = useCallback(async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const created = await invoke('canvas:create', { courseId })
      setBoards((current) => sortBoards([...(current ?? []), created]))
      openBoard(created.id)
    } catch (createError: unknown) {
      setError(errorMessage(createError, '새 화이트보드를 만들지 못했어요.'))
    } finally {
      setCreating(false)
    }
  }, [courseId, creating, openBoard])

  const renameBoard = useCallback(async (
    board: PersonalBoard,
    rawTitle: string
  ): Promise<void> => {
    if (cancelledRenameRef.current) {
      cancelledRenameRef.current = false
      return
    }
    const title = rawTitle.trim()
    if (title.length === 0) {
      setError('화이트보드 이름을 입력해 주세요.')
      return
    }
    if (title === board.title) {
      setEditingId(null)
      return
    }
    setRenamingId(board.id)
    setError(null)
    try {
      const renamed = await invoke('canvas:rename', { id: board.id, title })
      setBoards((current) =>
        current?.map((entry) => entry.id === renamed.id ? renamed : entry) ?? null
      )
      setEditingId(null)
    } catch (renameError: unknown) {
      setError(errorMessage(renameError, '화이트보드 이름을 바꾸지 못했어요.'))
    } finally {
      setRenamingId(null)
    }
  }, [])

  const removeBoard = useCallback(async (board: PersonalBoard): Promise<void> => {
    if (!window.confirm(`“${board.title}” 화이트보드를 삭제할까요?`)) return
    setRemovingId(board.id)
    setError(null)
    try {
      await invoke('canvas:remove', { id: board.id })
      setBoards((current) => current?.filter((entry) => entry.id !== board.id) ?? null)
      if (editingId === board.id) setEditingId(null)
    } catch (removeError: unknown) {
      setError(errorMessage(removeError, '화이트보드를 삭제하지 못했어요.'))
    } finally {
      setRemovingId(null)
    }
  }, [editingId])

  return (
    <section className="canvas-section" aria-label="개인 화이트보드">
      <div className="canvas-section__heading">
        <span>화이트보드</span>
        <button
          type="button"
          className="canvas-section__create"
          disabled={creating}
          onClick={() => void createBoard()}
        >
          <Icon name="plus" />
          {creating ? '만드는 중…' : '새 화이트보드'}
        </button>
      </div>

      {boards === null && (
        <p className="canvas-section__status" role="status">불러오는 중…</p>
      )}

      {boards !== null && boards.length > 0 && (
        <ul className="canvas-section__list">
          {boards.map((board) => (
            <li key={board.id} className="canvas-section__row">
              {editingId === board.id ? (
                <input
                  autoFocus
                  className="canvas-section__rename-input"
                  defaultValue={board.title}
                  aria-label="화이트보드 이름"
                  disabled={renamingId === board.id}
                  onBlur={(event) => void renameBoard(board, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      cancelledRenameRef.current = true
                      setEditingId(null)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="canvas-section__open"
                  onClick={() => openBoard(board.id)}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="1em"
                    height="1em"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <path d="M8 9h8M8 13h5M8 17h7" />
                  </svg>
                  <span>{board.title}</span>
                </button>
              )}

              <div className="canvas-section__actions">
                <button
                  type="button"
                  aria-label={`${board.title} 이름 변경`}
                  title="이름 변경"
                  disabled={removingId === board.id || renamingId === board.id}
                  onClick={() => {
                    cancelledRenameRef.current = false
                    setEditingId(board.id)
                  }}
                >
                  <Icon name="pencil" />
                </button>
                <button
                  type="button"
                  className="canvas-section__remove"
                  aria-label={`${board.title} 삭제`}
                  title="삭제"
                  disabled={removingId === board.id || renamingId === board.id}
                  onClick={() => void removeBoard(board)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {boards !== null && boards.length === 0 && error === null && (
        <p className="canvas-section__empty">혼자 생각을 펼칠 새 보드를 만들어 보세요.</p>
      )}

      {error !== null && (
        <p className="canvas-section__error" role="alert">{error}</p>
      )}
    </section>
  )
}
