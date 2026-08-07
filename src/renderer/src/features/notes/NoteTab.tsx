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
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { IDockviewPanelProps } from 'dockview'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject
} from 'react'
import type { NoteContent, NoteRef } from '../../../../shared/types/note'
import { invoke } from '../../lib/ipc'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { nativeHistoryGuard } from './nativeHistoryGuard'
import {
  EMPTY_NOTE_FORMAT_STATE,
  getNoteFormatState,
  type NoteFormatState
} from './noteFormatting'
import { NOTE_EDITOR_PLUGINS } from './noteEditorPlugins'
import { NoteToolbar } from './NoteToolbar'
import { QuizPreview } from './QuizPreview'
import { splitQuizMarkdown } from './quizMarkdown'
import {
  createNoteZoomShortcutPlugin,
  NOTE_FONT_SCALE_STORAGE_KEY,
  parseNoteFontScale,
  stepNoteFontScale,
  type NoteFontScale
} from './noteZoom'
import { taskListItemView } from './taskListView'
import './note-tab.css'

const SAVE_DELAY_MS = 800

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'
type NoteViewMode = 'edit' | 'quiz'

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
  onMarkdownChange,
  onFormatStateChange,
  onZoomStep
}: {
  initialMarkdown: string
  onMarkdownChange: (markdown: string) => void
  onFormatStateChange: (state: NoteFormatState) => void
  onZoomStep: (direction: -1 | 1) => void
}): JSX.Element {
  const onChangeRef = useRef(onMarkdownChange)
  const onFormatStateChangeRef = useRef(onFormatStateChange)
  const onZoomStepRef = useRef(onZoomStep)
  onChangeRef.current = onMarkdownChange
  onFormatStateChangeRef.current = onFormatStateChange
  onZoomStepRef.current = onZoomStep

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
          // Keeps the native Edit-menu ⌘Z from editing around ProseMirror.
          nativeHistoryGuard(),
          createNoteZoomShortcutPlugin((direction) =>
            onZoomStepRef.current(direction)
          ),
          new Plugin({
            view: (initialView) => {
              onFormatStateChangeRef.current(
                getNoteFormatState(initialView.state)
              )
              return {
                update: (view, previousState) => {
                  onFormatStateChangeRef.current(getNoteFormatState(view.state))
                  if (previousState.doc.eq(view.state.doc)) return
                  const markdown = context.get(serializerCtx)(view.state.doc)
                  onChangeRef.current(markdown)
                }
              }
            }
          })
        ])
      })

      return NOTE_EDITOR_PLUGINS.reduce(
        (instance, plugin) => instance.use(plugin),
        editor
      )
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

function NoteEditorWorkspace({
  initialMarkdown,
  onMarkdownChange,
  fontScale,
  onFontScaleChange,
  onZoomStep
}: {
  initialMarkdown: string
  onMarkdownChange: (markdown: string) => void
  fontScale: NoteFontScale
  onFontScaleChange: (scale: NoteFontScale) => void
  onZoomStep: (direction: -1 | 1) => void
}): JSX.Element {
  const [formatState, setFormatState] = useState<NoteFormatState>(
    EMPTY_NOTE_FORMAT_STATE
  )

  return (
    <div className="note-editor-scroll">
      <NoteToolbar
        formatState={formatState}
        fontScale={fontScale}
        onFontScaleChange={onFontScaleChange}
      />
      <MilkdownNoteEditor
        initialMarkdown={initialMarkdown}
        onMarkdownChange={onMarkdownChange}
        onFormatStateChange={setFormatState}
        onZoomStep={onZoomStep}
      />
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
  const [presentedMarkdown, setPresentedMarkdown] = useState('')
  const [viewMode, setViewMode] = useState<NoteViewMode>('edit')
  const [fontScale, setFontScale] = useState<NoteFontScale>(() => {
    try {
      return parseNoteFontScale(localStorage.getItem(NOTE_FONT_SCALE_STORAGE_KEY))
    } catch {
      return 1
    }
  })

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
      setPresentedMarkdown(note.markdown)
      setViewMode(splitQuizMarkdown(note.markdown) === null ? 'edit' : 'quiz')
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
    // Revive on (re)mount. StrictMode mounts → unmounts → remounts the SAME
    // instance, so refs survive the cycle: without this line the cleanup's
    // `false` sticks, every `if (aliveRef.current)` guard fails, and the
    // resolved notes:read is dropped on the floor — the tab then sits on
    // "필기를 불러오는 중…" forever.
    aliveRef.current = true
    return () => {
      clearTimer()
      void flushRef.current()
      aliveRef.current = false
    }
  }, [clearTimer])

  useEffect(() => {
    const syncFontScale = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const scale = parseNoteFontScale(String(event.detail))
      setFontScale(scale)
    }
    window.addEventListener('bandal:note-font-scale', syncFontScale)
    return () =>
      window.removeEventListener('bandal:note-font-scale', syncFontScale)
  }, [])

  const changeFontScale = useCallback((scale: NoteFontScale): void => {
    setFontScale(scale)
    try {
      localStorage.setItem(NOTE_FONT_SCALE_STORAGE_KEY, String(scale))
    } catch {
      // Storage may be unavailable in a locked-down renderer; keep the session value.
    }
    window.dispatchEvent(
      new CustomEvent('bandal:note-font-scale', { detail: scale })
    )
  }, [])

  const stepFontScale = useCallback(
    (direction: -1 | 1): void => {
      changeFontScale(stepNoteFontScale(fontScale, direction))
    },
    [changeFontScale, fontScale]
  )

  const handleMarkdownChange = useCallback(
    (markdown: string): void => {
      if (markdown === currentMarkdownRef.current) return
      currentMarkdownRef.current = markdown
      setPresentedMarkdown(markdown)

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

  const quizSections = useMemo(
    () => splitQuizMarkdown(presentedMarkdown),
    [presentedMarkdown]
  )

  const enterEditMode = useCallback((): void => {
    revisionRef.current += 1
    setEditorSeed({
      markdown: currentMarkdownRef.current,
      revision: revisionRef.current
    })
    setViewMode('edit')
  }, [])

  const enterQuizMode = useCallback((): void => {
    setViewMode('quiz')
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
        <div className="note-toolbar__actions">
          {quizSections !== null && (
            <button
              type="button"
              className="note-action note-toolbar__mode"
              onClick={viewMode === 'quiz' ? enterEditMode : enterQuizMode}
            >
              {viewMode === 'quiz' ? '편집 모드' : '풀이 모드'}
            </button>
          )}
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
        </div>
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
        <div
          className="note-editor"
          style={{ '--note-font-scale': fontScale } as CSSProperties}
        >
          {viewMode === 'quiz' && quizSections !== null ? (
            <QuizPreview sections={quizSections} />
          ) : (
            <MilkdownProvider key={editorSeed.revision}>
              <NoteEditorWorkspace
                initialMarkdown={editorSeed.markdown}
                onMarkdownChange={handleMarkdownChange}
                fontScale={fontScale}
                onFontScaleChange={changeFontScale}
                onZoomStep={stepFontScale}
              />
            </MilkdownProvider>
          )}
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
