import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createBoardRepo, type BoardRepo } from '../../src/main/features/board'
import { createTestDb, type TestDb } from './helpers/testDb'
import { taskCalendarInterval } from '../../src/shared/taskSchedule'
import { createAppleCalendarService, type CalendarNative } from '../../src/main/features/calendar/appleCalendarService'
import { boardTasksByDay } from '../../src/renderer/src/features/calendar/boardTaskDays'
import { appleEventsByDay } from '../../src/renderer/src/features/calendar/appleCalendarDays'
import { calendarMonthGrid, dueAtForLocalInput } from '../../src/renderer/src/features/calendar/calendarDate'
import { runMigrations } from '../../src/main/db/migrations'

describe('task schedules across storage, calendar layout and export', () => {
  let ctx: TestDb
  let repo: BoardRepo
  beforeEach(() => { ctx = createTestDb(); repo = createBoardRepo(ctx.db) })
  afterEach(() => { vi.useRealTimers(); ctx.cleanup() })
  const timed = (day: string, time: string) => dueAtForLocalInput(day, time, false)
  const grid = () => calendarMonthGrid(new Date(2026, 9, 1))

  test.each(['00:00', '11:59', '23:59'])('keeps a %s deadline on exactly one day when exported and read back', async time => {
    const dueAt = timed('2026-10-08', time)
    const task = repo.create({ title: '과제2', courseId: null, dueAt, allDay: false })
    const native = {
      state: vi.fn<CalendarNative['state']>().mockResolvedValue({ authorization: 'authorized', calendars: [{ id: 'study', title: '공부', source: 'iCloud', color: '#000', writable: true }], defaultCalendarId: 'study' }),
      events: vi.fn<CalendarNative['events']>().mockResolvedValue([]),
      export: vi.fn<CalendarNative['export']>().mockResolvedValue({ eventId: 'existing', updated: true })
    }
    const service = createAppleCalendarService({ supported: true, native, load: () => ({ connected: true, destinationCalendarId: 'study', exports: { [task.id]: 'existing' } }), save: vi.fn(), changed: vi.fn(), task: () => task })
    await service.exportTask(task.id)
    const exported = native.export.mock.calls[0]![0]
    expect(exported).toMatchObject({ start: dueAt, end: dueAt, allDay: false, eventId: 'existing' })
    expect([...boardTasksByDay([task], grid().days).keys()]).toEqual(['2026-10-08'])
    const readBack = { ...exported, id: 'event', calendarId: 'study', calendarTitle: '공부', color: '#000', location: '', bandalTaskId: task.id }
    expect([...appleEventsByDay([readBack], grid().days, new Set()).keys()]).toEqual(['2026-10-08'])
  })

  test('persists an inclusive all-day range and exports an exclusive end', () => {
    const task = repo.create({ courseId: null, title: '축제', allDay: true, startAt: '2026-09-30', dueAt: '2026-10-02' })
    expect(repo.update({ id: task.id, title: '학교 축제' })).toMatchObject({ startAt: '2026-09-30', dueAt: '2026-10-02' })
    expect(taskCalendarInterval(task)).toEqual({ start: '2026-09-30', end: '2026-10-03', allDay: true })
    expect([...boardTasksByDay([task], grid().days).keys()]).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
    expect(repo.listRange({ from: timed('2026-10-01', '00:00'), to: timed('2026-10-02', '00:00') }).map(entry => entry.id)).toEqual([task.id])
  })

  test('finds ranges enclosing the entire view and excludes ranges ending at its boundary', () => {
    const spanning = repo.create({ courseId: null, title: '장기 프로젝트', allDay: false, startAt: timed('2026-08-01', '09:00'), dueAt: timed('2026-11-01', '18:00') })
    repo.create({ courseId: null, title: '자정 종료', allDay: false, startAt: timed('2026-09-30', '20:00'), dueAt: timed('2026-10-01', '00:00') })
    expect(repo.listRange({ from: timed('2026-10-01', '00:00'), to: timed('2026-11-01', '00:00') })).toEqual([spanning])
  })

  test('a single all-day event overlaps a partial-day query', () => {
    const task = repo.create({ courseId: null, title: '종일', allDay: true, dueAt: '2026-10-08' })
    expect(repo.listRange({ from: timed('2026-10-08', '10:00'), to: timed('2026-10-08', '11:00') })).toEqual([task])
  })

  test('a timed range ending at midnight occupies the preceding day only', () => {
    const task = repo.create({ courseId: null, title: '실험', startAt: timed('2026-10-08', '20:00'), dueAt: timed('2026-10-09', '00:00') })
    expect([...boardTasksByDay([task], grid().days).keys()]).toEqual(['2026-10-08'])
    expect(taskCalendarInterval(task)).toMatchObject({ start: task.startAt, end: task.dueAt })
    expect(repo.listRange({ from: timed('2026-10-09', '00:00'), to: timed('2026-10-10', '00:00') })).toEqual([])
  })

  test('intentional overnight events occupy both days, while deadline counts use their end', () => {
    const task = repo.create({ courseId: null, title: '밤샘 실험', startAt: timed('2026-10-08', '23:00'), dueAt: timed('2026-10-09', '02:00') })
    expect([...boardTasksByDay([task], grid().days).keys()]).toEqual(['2026-10-08', '2026-10-09'])
    vi.useFakeTimers().setSystemTime(new Date(2026, 9, 8, 23, 30))
    expect(repo.upcoming()[0]).toMatchObject({ task, daysLeft: 1, overdue: false })
  })

  test('rejects reverse ranges, missing ends and invalid calendar dates atomically', () => {
    const task = repo.create({ courseId: null, title: '일정', allDay: true, startAt: '2026-10-08', dueAt: '2026-10-09' })
    expect(() => repo.update({ id: task.id, dueAt: '2026-10-07' })).toThrow('종료')
    expect(repo.list()[0]).toEqual(task)
    expect(() => repo.create({ courseId: null, title: 'missing', allDay: true, startAt: '2026-10-08' })).toThrow()
    expect(() => repo.create({ courseId: null, title: 'invalid', allDay: true, dueAt: '2026-02-30' })).toThrow()
    expect(() => repo.update({ id: task.id, allDay: false, startAt: timed('2026-10-08', '12:00'), dueAt: timed('2026-10-08', '11:59') })).toThrow()
  })

  test('can remove a range or remove its schedule while preserving ordinary task edits', () => {
    const task = repo.create({ courseId: null, title: '일정', allDay: true, startAt: '2026-10-08', dueAt: '2026-10-09' })
    expect(repo.update({ id: task.id, status: 'done' }).startAt).toBe('2026-10-08')
    expect(repo.update({ id: task.id, startAt: null })).toMatchObject({ startAt: null, dueAt: '2026-10-09' })
    repo.update({ id: task.id, startAt: '2026-10-08' })
    expect(repo.update({ id: task.id, dueAt: null })).toMatchObject({ startAt: null, dueAt: null })
  })

  test.each([
    ['2026-10-08', '2026-10-08', '2026-10-09'],
    ['2028-02-28', '2028-02-29', '2028-03-01'],
    ['2026-12-31', '2026-12-31', '2027-01-01'],
    ['2026-03-07', '2026-03-09', '2026-03-10'],
    ['2026-10-31', '2026-11-02', '2026-11-03']
  ])('preserves floating dates across month/year/leap/DST boundaries: %s–%s', (startAt, dueAt, end) => {
    const task = repo.create({ courseId: null, title: '종일', startAt, dueAt, allDay: true })
    expect(taskCalendarInterval(task)).toEqual({ start: startAt, end, allDay: true })
  })

  test('migration preserves existing deadlines without inventing a start', () => {
    const task = repo.create({ courseId: null, title: '기존 마감', dueAt: timed('2026-10-08', '23:59') })
    ctx.db.exec('ALTER TABLE board_tasks DROP COLUMN start_at; DELETE FROM migrations WHERE version = 34')
    runMigrations(ctx.db)
    expect(repo.list()).toEqual([task])
    runMigrations(ctx.db)
    expect(repo.list()[0]?.startAt).toBeNull()
  })
})
