import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TASK_COLORS } from '../../../../shared/types/board'
import type {
  BoardTask,
  TaskColor,
  TaskStatus,
  UpdateTaskInput
} from '../../../../shared/types/board'
import { DEFAULT_SETTINGS, type Settings, type WidgetId } from '../../../../shared/types/settings'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { useUniversityStore } from '../../stores/universityStore'
import { dueDayLabel } from '../board/boardLogic'
import { localDateKey } from '../calendar/calendarDate'
import { NativeMailWidget } from './MailWidget'
import './widgets.css'

const LABELS: Record<WidgetId, string> = {
  todo: '투두',
  board: '보드',
  mail: '메일'
}

const TASK_COLOR_LABELS: Record<TaskColor, string> = {
  none: '색상 없음',
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  violet: '보라'
}

function TaskColorPicker({
  value,
  onChange,
  label = '할 일 색상'
}: {
  value: TaskColor
  onChange: (color: TaskColor) => void
  label?: string
}): JSX.Element {
  return (
    <div className="widget-color-picker" role="group" aria-label={label}>
      {TASK_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="widget-color-swatch"
          data-color={color}
          aria-label={TASK_COLOR_LABELS[color]}
          aria-pressed={value === color}
          title={TASK_COLOR_LABELS[color]}
          onClick={() => onChange(color)}
        >
          {color === 'none' && <span aria-hidden="true">×</span>}
        </button>
      ))}
    </div>
  )
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

function useBoardTasks(): { tasks: BoardTask[]; loading: boolean } {
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [loading, setLoading] = useState(true)
  const loadSequence = useRef(0)
  const load = useCallback((showLoading = true) => {
    const sequence = ++loadSequence.current
    if (showLoading) setLoading(true)
    void invoke('board:listTasks', { includeDone: true })
      .then((next) => {
        if (sequence === loadSequence.current) setTasks(next)
      })
      .catch((loadError: unknown) => {
        console.error('[Bandal] 위젯 할 일을 불러오지 못했습니다.', loadError)
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false)
      })
  }, [])
  useEffect(() => {
    load()
    const stop = onPush('board:changed', () => load(false))
    return () => {
      stop()
      loadSequence.current += 1
    }
  }, [load])
  return { tasks, loading }
}

function byDue(left: BoardTask, right: BoardTask): number {
  if (left.dueAt === null && right.dueAt !== null) return 1
  if (left.dueAt !== null && right.dueAt === null) return -1
  return (left.dueAt ?? '').localeCompare(right.dueAt ?? '') || left.sortOrder - right.sortOrder
}

function taskDateLabel(task: BoardTask): string | null {
  if (task.dueAt === null) return null
  const dateKey = localDateKey(task.dueAt)
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric'
  }).format(date)
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
  const [draftDate, setDraftDate] = useState('')
  const [draftColor, setDraftColor] = useState<TaskColor>('none')
  const [editingId, setEditingId] = useState<string | null>(null)
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
        status: 'todo',
        color: draftColor,
        dueAt: draftDate === '' ? null : draftDate,
        allDay: draftDate !== ''
      })
      setDraft('')
      setDraftDate('')
      setDraftColor('none')
    } catch (createError) {
      console.error('[Bandal] 위젯 할 일을 추가하지 못했습니다.', createError)
      showToast('할 일을 추가하지 못했어요.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const updateTask = (input: UpdateTaskInput): void => {
    void invoke('board:updateTask', input).catch((updateError: unknown) => {
      console.error('[Bandal] 위젯 할 일을 수정하지 못했습니다.', updateError)
      showToast('할 일을 수정하지 못했어요.', 'danger')
    })
  }

  const updateStatus = (task: BoardTask, status: TaskStatus): void => {
    updateTask({ id: task.id, status })
  }

  const updateDate = (task: BoardTask, dueAt: string): void => {
    updateTask({
      id: task.id,
      dueAt: dueAt === '' ? null : dueAt,
      allDay: dueAt !== ''
    })
  }

  const updateColor = (task: BoardTask, color: TaskColor): void => {
    updateTask({ id: task.id, color })
  }

  const list = [...visible].sort(byDue)
  return (
    <div className="widget-task">
      <div className="widget-toolbar">
        <TaskScope currentOnly={currentOnly} onChange={setCurrentOnly} />
        <button type="button" className="widget-open-board" onClick={toggleBoard}>전체 보드</button>
      </div>
      <form className="widget-quick-add" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <div className="widget-quick-add__title">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="할 일 추가" aria-label="할 일 추가" />
          <button type="submit" disabled={draft.trim() === '' || saving} aria-label="추가"><Icon name="plus" /></button>
        </div>
        <div className="widget-quick-add__options">
          <label className="widget-date-field">
            <span>날짜</span>
            <input
              type="date"
              value={draftDate}
              aria-label="할 일 날짜"
              onChange={(event) => setDraftDate(event.target.value)}
            />
          </label>
          <TaskColorPicker value={draftColor} onChange={setDraftColor} />
        </div>
      </form>
      {loading ? (
        <p className="widget-empty">불러오는 중…</p>
      ) : mode === 'todo' ? (
        <ul className="widget-todo-list">
          {list.filter((task) => task.status !== 'done').map((task) => (
            <li key={task.id} data-color={task.color} data-expanded={editingId === task.id || undefined}>
              <div className="widget-todo-row">
                <button type="button" className="widget-check" aria-label={`${task.title} 완료`} onClick={() => updateStatus(task, 'done')} />
                <button
                  type="button"
                  className="widget-task-copy"
                  aria-expanded={editingId === task.id}
                  onClick={() => setEditingId((current) => current === task.id ? null : task.id)}
                >
                  <strong>{task.title}</strong>
                  <small>
                    {task.courseId === null ? '전체' : (courseNames.get(task.courseId) ?? '알 수 없는 과목')}
                    {task.dueAt === null ? '' : ` · ${taskDateLabel(task) ?? ''} · ${dueDayLabel(task.dueAt) ?? ''}`}
                  </small>
                </button>
                <span className="widget-task-color" data-color={task.color} aria-hidden="true" />
              </div>
              {editingId === task.id && (
                <div className="widget-todo-editor" aria-label={`${task.title} 빠른 편집`}>
                  <label className="widget-date-field">
                    <span>날짜</span>
                    <input
                      type="date"
                      value={task.dueAt === null ? '' : localDateKey(task.dueAt)}
                      aria-label={`${task.title} 날짜`}
                      onChange={(event) => updateDate(task, event.target.value)}
                    />
                  </label>
                  <TaskColorPicker
                    value={task.color}
                    label={`${task.title} 색상`}
                    onChange={(color) => updateColor(task, color)}
                  />
                </div>
              )}
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
                <button key={task.id} type="button" data-color={task.color} title="다음 상태로 이동" onClick={() => updateStatus(task, status === 'todo' ? 'in-progress' : status === 'in-progress' ? 'done' : 'todo')}>
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
  const target = selected === null
    ? (settings.widgets.mailUrl === '' ? null : {
        label: '웹메일',
        url: settings.widgets.mailUrl
      })
    : {
        label: selected.label,
        url: selected.url
      }

  return <NativeMailWidget fallback={target} />
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
