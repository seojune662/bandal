import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardTask, TaskStatus } from '../../../../shared/types/board'
import { DEFAULT_SETTINGS, type Settings, type WidgetId } from '../../../../shared/types/settings'
import { Icon } from '../../app/icons'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { useUniversityStore } from '../../stores/universityStore'
import { dueDayLabel } from '../board/boardLogic'
import { openShortcut } from '../university/openService'
import './widgets.css'

const LABELS: Record<WidgetId, string> = {
  todo: '투두',
  board: '보드',
  mail: '메일'
}

function useLiveSettings(): Settings {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  useEffect(() => {
    let alive = true
    void invoke('settings:get', {}).then((next) => {
      if (alive) setSettings(next)
    })
    const stop = onPush('settings:changed', ({ settings: next }) => setSettings(next))
    return () => {
      alive = false
      stop()
    }
  }, [])
  return settings
}

function useBoardTasks(): { tasks: BoardTask[]; loading: boolean; reload: () => void } {
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    setLoading(true)
    void invoke('board:listTasks', { includeDone: true })
      .then(setTasks)
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
    return onPush('board:changed', load)
  }, [load])
  return { tasks, loading, reload: load }
}

function byDue(left: BoardTask, right: BoardTask): number {
  if (left.dueAt === null && right.dueAt !== null) return 1
  if (left.dueAt !== null && right.dueAt === null) return -1
  return (left.dueAt ?? '').localeCompare(right.dueAt ?? '') || left.sortOrder - right.sortOrder
}

function TaskScope({ currentOnly, onChange }: { currentOnly: boolean; onChange: (next: boolean) => void }): JSX.Element {
  return (
    <div className="widget-scope" role="group" aria-label="태스크 범위">
      <button type="button" aria-pressed={!currentOnly} onClick={() => onChange(false)}>전체</button>
      <button type="button" aria-pressed={currentOnly} onClick={() => onChange(true)}>현재 과목</button>
    </div>
  )
}

function TaskWidget({ mode }: { mode: 'todo' | 'board' }): JSX.Element {
  const { tasks, loading } = useBoardTasks()
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const toggleBoard = useUiStore((state) => state.toggleBoardOverlay)
  const [currentOnly, setCurrentOnly] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const visible = useMemo(
    () => tasks.filter((task) => !currentOnly || task.courseId === selectedCourseId),
    [currentOnly, selectedCourseId, tasks]
  )
  const courseNames = useMemo(() => new Map(courses.map((course) => [course.id, course.name])), [courses])

  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (title === '' || saving) return
    setSaving(true)
    try {
      await invoke('board:createTask', {
        courseId: selectedCourseId,
        title,
        status: 'todo'
      })
      setDraft('')
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = (task: BoardTask, status: TaskStatus): void => {
    void invoke('board:updateTask', { id: task.id, status })
  }

  const list = [...visible].sort(byDue)
  return (
    <div className="widget-task">
      <div className="widget-toolbar">
        <TaskScope currentOnly={currentOnly} onChange={setCurrentOnly} />
        <button type="button" className="widget-open-board" onClick={toggleBoard}>전체 보드</button>
      </div>
      <form className="widget-quick-add" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="할 일 추가" aria-label="할 일 추가" />
        <button type="submit" disabled={draft.trim() === '' || saving} aria-label="추가"><Icon name="plus" /></button>
      </form>
      {loading ? (
        <p className="widget-empty">불러오는 중…</p>
      ) : mode === 'todo' ? (
        <ul className="widget-todo-list">
          {list.filter((task) => task.status !== 'done').map((task) => (
            <li key={task.id}>
              <button type="button" className="widget-check" aria-label={`${task.title} 완료`} onClick={() => updateStatus(task, 'done')} />
              <span className="widget-task-copy"><strong>{task.title}</strong><small>{task.courseId === null ? '전체' : (courseNames.get(task.courseId) ?? '알 수 없는 과목')}{task.dueAt === null ? '' : ` · ${dueDayLabel(task.dueAt) ?? ''}`}</small></span>
            </li>
          ))}
          {list.every((task) => task.status === 'done') && <li className="widget-empty">남은 할 일이 없어요.</li>}
        </ul>
      ) : (
        <div className="widget-board-columns">
          {(['todo', 'in-progress', 'done'] as const).map((status) => (
            <section key={status}>
              <h4>{status === 'todo' ? '할 일' : status === 'in-progress' ? '진행 중' : '완료'} <span>{list.filter((task) => task.status === status).length}</span></h4>
              {list.filter((task) => task.status === status).slice(0, 5).map((task) => (
                <button key={task.id} type="button" title="다음 상태로 이동" onClick={() => updateStatus(task, status === 'todo' ? 'in-progress' : status === 'in-progress' ? 'done' : 'todo')}>
                  {task.title}
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function MailWidget({ settings }: { settings: Settings }): JSX.Element {
  const services = useUniversityStore((state) => state.services)
  const init = useUniversityStore((state) => state.init)
  useEffect(() => void init(), [init])
  const mails = services.filter((service) => service.kind === 'mail')
  const selected = mails.find((service) => service.id === settings.widgets.mailServiceId) ?? mails[0] ?? null
  const target = selected ?? (settings.widgets.mailUrl === '' ? null : {
    id: 'custom', label: '웹메일', url: settings.widgets.mailUrl, opensExternally: false
  })

  if (target === null) {
    return <div className="widget-mail"><p>설정에서 학교 메일이나 URL을 연결해 주세요.</p></div>
  }
  return (
    <div className="widget-mail">
      <span className="widget-mail__icon">✉️</span>
      <strong>{target.label}</strong>
      <small>{new URL(target.url).hostname}</small>
      <button type="button" onClick={() => {
        openShortcut(target)
        void invoke('settings:set', { widgets: { lastMailOpenedAt: new Date().toISOString() } })
      }}>메일 열기</button>
      {settings.widgets.lastMailOpenedAt !== null && <span className="widget-mail__last">마지막 열기 {new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(settings.widgets.lastMailOpenedAt))}</span>}
    </div>
  )
}

export function WidgetDock(): JSX.Element | null {
  const settings = useLiveSettings()
  const widgets = settings.widgets
  const dockRef = useRef<HTMLElement>(null)
  if (widgets.enabled.length === 0) return null

  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rail = dockRef.current?.parentElement
    if (rail === undefined || rail === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = rail.getBoundingClientRect()
    const move = (moveEvent: PointerEvent): void => {
      const ratio = Math.min(0.65, Math.max(0.25, (rect.bottom - moveEvent.clientY) / rect.height))
      if (dockRef.current !== null) dockRef.current.style.height = `${ratio * 100}%`
    }
    const end = (upEvent: PointerEvent): void => {
      const ratio = Math.min(0.65, Math.max(0.25, (rect.bottom - upEvent.clientY) / rect.height))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      void invoke('settings:set', { widgets: { heightRatio: ratio } })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  return (
    <>
      <div className="widget-divider" role="separator" aria-orientation="horizontal" onPointerDown={beginResize} />
      <section ref={dockRef} className="widget-dock" style={{ height: `${widgets.heightRatio * 100}%` }} aria-label="위젯">
        <header className="widget-tabs" role="tablist">
          {widgets.enabled.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={widgets.active === id} onClick={() => void invoke('settings:set', { widgets: { active: id } })}>{LABELS[id]}</button>
          ))}
        </header>
        <div className="widget-content" role="tabpanel">
          {widgets.active === 'mail' ? <MailWidget settings={settings} /> : <TaskWidget mode={widgets.active} />}
        </div>
      </section>
    </>
  )
}
