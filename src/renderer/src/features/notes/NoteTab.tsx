import {
  Editor,
  defaultValueCtx,
  nodeViewCtx,
  prosePluginsCtx,
  rootAttrsCtx,
  rootCtx,
  serializerCtx
} from '@milkdown/core'
import { Plugin } from '@milkdown/prose/state'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { IDockviewPanelProps } from 'dockview'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject
} from 'react'
import type { NoteContent, NoteRef } from '../../../../shared/types/note'
import { invoke } from '../../lib/ipc'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { taskListItemView } from './taskListView'
import './note-tab.css'

const SAVE_DELAY_MS = 800

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

interface EditorSeed {
  markdown: string
  revision: number
}

interface NoteSessionProps extends NoteRef {
  panelApi: IDockviewPanelProps['api']
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: '저장됨',
  dirty: '저장 대기',
  saving: '저장 중',
  conflict: '충돌',
  error: '저장 실패'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isNoteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; message?: unknown }
  return (
    candidate.name === 'ConflictError' ||
    (typeof candidate.message === 'string' && candidate.message.includes('[conflict]'))
  )
}

function MilkdownNoteEditor({
  initialMarkdown,
  onMarkdownChange
}: {
  initialMarkdown: string
  onMarkdownChange: (markdown: string) => void
}): JSX.Element {
  const onChangeRef = useRef(onMarkdownChange)
  onChangeRef.current = onMarkdownChange

  const { loading } = useEditor(
    (root) => {
      const editor = Editor.make().config((context) => {
        context.set(rootCtx, root)
        context.set(defaultValueCtx, initialMarkdown)
        context.set(rootAttrsCtx, {
          'aria-label': '마크다운 필기 편집기',
          'aria-multiline': 'true'
        })
        context.update(nodeViewCtx, (views) => [
          ...views.filter(([name]) => name !== 'list_item'),
          ['list_item', taskListItemView] as [string, typeof taskListItemView]
        ])
        context.update(prosePluginsCtx, (plugins) => [
          ...plugins,
          new Plugin({
            view: () => ({
              update: (view, previousState) => {
                if (previousState.doc.eq(view.state.doc)) return
                const markdown = context.get(serializerCtx)(view.state.doc)
                onChangeRef.current(markdown)
              }
            })
          })
        ])
      })

      return editor.use(commonmark).use(gfm)
    },
    [initialMarkdown]
  )

  return (
    <div className="note-editor-shell" aria-busy={loading}>
      {loading && <div className="note-editor-loading">편집기 준비 중…</div>}
      <Milkdown />
    </div>
  )
}

function useLatest<T>(value: T): MutableRefObject<T> {
  const valueRef = useRef(value)
  valueRef.current = value
  return valueRef
}

function NoteSession({ courseId, relPath, panelApi }: NoteSessionProps): JSX.Element {
  const [editorSeed, setEditorSeed] = useState<EditorSeed | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [conflictBusy, setConflictBusy] = useState(false)

  const aliveRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentMarkdownRef = useRef('')
  const persistedMarkdownRef = useRef('')
  const mtimeRef = useRef<number | null>(null)
  const conflictRef = useRef(false)
  const writeInFlightRef = useRef<Promise<void> | null>(null)
  const revisionRef = useRef(0)
  const flushRef = useRef<(overwrite?: boolean) => Promise<void>>(async () => undefined)
  const scheduleRef = useRef<() => void>(() => undefined)
  const noteRef = useLatest<NoteRef>({ courseId, relPath })

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const setStatusIfMounted = useCallback(
    (nextStatus: SaveStatus, detail: string | null = null): void => {
      if (!aliveRef.current) return
      setStatus(nextStatus)
      setStatusDetail(detail)
    },
    []
  )

  const flush = useCallback(
    async (overwrite = false): Promise<void> => {
      clearTimer()

      const inFlight = writeInFlightRef.current
      if (inFlight !== null) {
        await inFlight
        if (
          currentMarkdownRef.current !== persistedMarkdownRef.current &&
          (!conflictRef.current || overwrite)
        ) {
          await flushRef.current(overwrite)
        }
        return
      }

      if (mtimeRef.current === null || (conflictRef.current && !overwrite)) return
      const markdown = currentMarkdownRef.current
      if (markdown === persistedMarkdownRef.current && !overwrite) {
        setStatusIfMounted('saved')
        return
      }

      setStatusIfMounted('saving')
      const ref = noteRef.current
      const expectedMtime = mtimeRef.current
      const request = (async () => {
        try {
          const result = await invoke('notes:write', {
            ...ref,
            markdown,
            ...(overwrite ? {} : { expectedMtime })
          })
          mtimeRef.current = result.mtime
          persistedMarkdownRef.current = markdown
          conflictRef.current = false

          if (currentMarkdownRef.current === markdown) {
            setStatusIfMounted('saved')
          } else {
            setStatusIfMounted('dirty')
            scheduleRef.current()
          }
        } catch (error) {
          if (isNoteConflict(error)) {
            conflictRef.current = true
            setStatusIfMounted('conflict', '디스크의 파일이 편집 중 변경되었습니다.')
          } else if (overwrite) {
            conflictRef.current = true
            setStatusIfMounted('conflict', errorMessage(error))
          } else {
            setStatusIfMounted('error', errorMessage(error))
          }
        } finally {
          writeInFlightRef.current = null
        }
      })()
      writeInFlightRef.current = request
      await request

      if (
        overwrite &&
        !conflictRef.current &&
        currentMarkdownRef.current !== persistedMarkdownRef.current
      ) {
        await flushRef.current()
      }
    },
    [clearTimer, noteRef, setStatusIfMounted]
  )
  flushRef.current = flush

  const scheduleSave = useCallback((): void => {
    if (!aliveRef.current || conflictRef.current) return
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flushRef.current()
    }, SAVE_DELAY_MS)
  }, [clearTimer])
  scheduleRef.current = scheduleSave

  const applyLoadedNote = useCallback(
    (note: NoteContent): void => {
      clearTimer()
      currentMarkdownRef.current = note.markdown
      persistedMarkdownRef.current = note.markdown
      mtimeRef.current = note.mtime
      conflictRef.current = false
      revisionRef.current += 1
      setEditorSeed({ markdown: note.markdown, revision: revisionRef.current })
      setLoadError(null)
      setStatusIfMounted('saved')
    },
    [clearTimer, setStatusIfMounted]
  )

  const loadNote = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const note = await invoke('notes:read', noteRef.current)
      if (aliveRef.current) applyLoadedNote(note)
    } catch (error) {
      if (aliveRef.current) setLoadError(errorMessage(error))
    }
  }, [applyLoadedNote, noteRef])

  useEffect(() => {
    void loadNote()
  }, [loadNote])

  useEffect(() => {
    const disposable = panelApi.onDidActiveChange(({ isActive }) => {
      if (!isActive) void flushRef.current()
    })
    return () => disposable.dispose()
  }, [panelApi])

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      void flushRef.current()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    return () => {
      clearTimer()
      void flushRef.current()
      aliveRef.current = false
    }
  }, [clearTimer])

  const handleMarkdownChange = useCallback(
    (markdown: string): void => {
      if (markdown === currentMarkdownRef.current) return
      currentMarkdownRef.current = markdown

      if (conflictRef.current) return
      if (markdown === persistedMarkdownRef.current) {
        clearTimer()
        setStatusIfMounted('saved')
        return
      }
      setStatusIfMounted('dirty')
      scheduleSave()
    },
    [clearTimer, scheduleSave, setStatusIfMounted]
  )

  const reloadFromDisk = useCallback(async (): Promise<void> => {
    setConflictBusy(true)
    try {
      const note = await invoke('notes:read', noteRef.current)
      if (aliveRef.current) applyLoadedNote(note)
    } catch (error) {
      setStatusIfMounted('conflict', errorMessage(error))
    } finally {
      if (aliveRef.current) setConflictBusy(false)
    }
  }, [applyLoadedNote, noteRef, setStatusIfMounted])

  const keepMine = useCallback(async (): Promise<void> => {
    setConflictBusy(true)
    try {
      await flushRef.current(true)
    } finally {
      if (aliveRef.current) setConflictBusy(false)
    }
  }, [])

  const fileName = relPath.split('/').at(-1) ?? relPath

  if (loadError !== null && editorSeed === null) {
    return (
      <div className="note-tab note-tab--message">
        <p>필기를 불러오지 못했습니다.</p>
        <p className="note-tab__error-detail">{loadError}</p>
        <button type="button" className="note-action" onClick={() => void loadNote()}>
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div className="note-tab">
      <header className="note-toolbar">
        <span className="note-toolbar__path" title={relPath}>
          {fileName}
        </span>
        <span
          className="note-save-status"
          data-status={status}
          title={statusDetail ?? STATUS_LABEL[status]}
          role="status"
          aria-live="polite"
        >
          <span className="note-save-status__dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </header>

      {status === 'conflict' && (
        <div className="note-conflict" role="alert">
          <div>
            <strong>디스크에서 변경됨</strong>
            <span>{statusDetail}</span>
          </div>
          <div className="note-conflict__actions">
            <button
              type="button"
              className="note-action"
              disabled={conflictBusy}
              onClick={() => void reloadFromDisk()}
            >
              다시 불러오기
            </button>
            <button
              type="button"
              className="note-action note-action--primary"
              disabled={conflictBusy}
              onClick={() => void keepMine()}
            >
              내 버전 유지
            </button>
          </div>
        </div>
      )}

      {editorSeed === null ? (
        <div className="note-tab__loading" role="status">
          필기를 불러오는 중…
        </div>
      ) : (
        <div className="note-editor-scroll">
          <MilkdownProvider key={editorSeed.revision}>
            <MilkdownNoteEditor
              initialMarkdown={editorSeed.markdown}
              onMarkdownChange={handleMarkdownChange}
            />
          </MilkdownProvider>
        </div>
      )}
    </div>
  )
}

export default function NoteTab(props: IDockviewPanelProps): JSX.Element {
  const candidate = props.params['descriptor']
  if (!isTabDescriptor(candidate) || candidate.kind !== 'note') {
    return (
      <div className="note-tab note-tab--message" role="alert">
        올바르지 않은 필기 탭입니다.
      </div>
    )
  }

  const { courseId, relPath } = candidate.payload
  return (
    <NoteSession
      key={`${courseId}:${relPath}`}
      courseId={courseId}
      relPath={relPath}
      panelApi={props.api}
    />
  )
}
