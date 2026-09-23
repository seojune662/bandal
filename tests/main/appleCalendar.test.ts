import { describe, expect, test, vi } from 'vitest'
import { createAppleCalendarService, EMPTY_CALENDAR_CONFIG, type CalendarNative } from '../../src/main/features/calendar/appleCalendarService'
import type { BoardTask } from '../../src/shared/types/board'
import { appleEventsByDay } from '../../src/renderer/src/features/calendar/appleCalendarDays'
import { calendarMonthGrid } from '../../src/renderer/src/features/calendar/calendarDate'
import type { AppleCalendarEvent } from '../../src/shared/types/appleCalendar'

const calendars = [
  { id: 'personal', title: '개인', source: 'iCloud', color: '#112233', writable: true },
  { id: 'holidays', title: '공휴일', source: '구독', color: '#334455', writable: false }
]
const task: BoardTask = { id: 'task-1', title: '과제', notes: '', courseId: null, startAt: null, dueAt: '2026-09-22', allDay: true, status: 'todo', kind: 'assignment', color: 'none', sortOrder: 0, createdAt: '', updatedAt: '' }
function fixture(options: { supported?: boolean; connected?: boolean } = {}) {
  const native = {
    state: vi.fn<CalendarNative['state']>().mockResolvedValue({ authorization: 'authorized', calendars, defaultCalendarId: 'personal' }),
    events: vi.fn<CalendarNative['events']>().mockResolvedValue([]),
    export: vi.fn<CalendarNative['export']>().mockResolvedValue({ eventId: 'event-1', updated: false })
  }
  const save = vi.fn(), changed = vi.fn()
  const service = createAppleCalendarService({ supported: options.supported ?? true, native, load: () => ({ ...EMPTY_CALENDAR_CONFIG, connected: options.connected ?? false }), save, changed, task: id => id === task.id ? task : undefined })
  return { service, native, save, changed }
}
describe('Apple Calendar integration', () => {
  test('checking status does not request permission or enumerate disconnected calendars', async () => {
    const { service, native } = fixture()
    await service.state()
    expect(native.state).toHaveBeenCalledWith(false, false)
    expect(await service.events({ from: '2026-09-01', to: '2026-10-01' })).toEqual([])
    expect(native.events).not.toHaveBeenCalled()
  })
  test('unsupported platforms never launch EventKit', async () => {
    const { service, native } = fixture({ supported: false })
    expect((await service.connect()).supported).toBe(false)
    await service.state()
    expect(native.state).not.toHaveBeenCalled()
  })
  test('explicit connect selects available calendars and writable default', async () => {
    const { service, native, save } = fixture()
    const state = await service.connect()
    expect(native.state).toHaveBeenCalledWith(true, true)
    expect(state.selectedCalendarIds).toEqual(['personal', 'holidays'])
    expect(state.destinationCalendarId).toBe('personal')
    expect(save).toHaveBeenCalledOnce()
  })
  test('denial does not create a connection', async () => {
    const { service, native, save } = fixture()
    native.state.mockResolvedValue({ authorization: 'denied', calendars: [], defaultCalendarId: null })
    expect((await service.connect()).connected).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
  test('empty selection means no events, never all calendars', async () => {
    const { service, native } = fixture()
    await service.connect()
    await service.configure({ selectedCalendarIds: [], destinationCalendarId: 'personal' })
    await service.events({ from: '2026-09-01', to: '2026-10-01' })
    expect(native.events).not.toHaveBeenCalled()
    await service.disconnect()
    expect((await service.connect()).selectedCalendarIds).toEqual([])
  })
  test('reconnecting keeps every calendar and destination intentionally disabled', async () => {
    const { service } = fixture()
    await service.connect()
    await service.configure({ selectedCalendarIds: [], destinationCalendarId: null })
    await service.disconnect()
    const state = await service.connect()
    expect(state.selectedCalendarIds).toEqual([])
    expect(state.destinationCalendarId).toBeNull()
  })
  test('removed calendars do not trap the settings form with stale selections', async () => {
    const { service, native } = fixture()
    await service.connect()
    native.state.mockResolvedValue({ authorization: 'authorized', calendars: [calendars[1]!], defaultCalendarId: null })
    const state = await service.state()
    expect(state.selectedCalendarIds).toEqual(['holidays'])
    expect(state.destinationCalendarId).toBeNull()
    await expect(service.configure({ selectedCalendarIds: [], destinationCalendarId: null })).resolves.toMatchObject({ selectedCalendarIds: [] })
  })
  test('rejects read-only destination and unknown calendar IDs', async () => {
    const { service } = fixture({ connected: true })
    await expect(service.configure({ selectedCalendarIds: ['holidays'], destinationCalendarId: 'holidays' })).rejects.toThrow('저장할 수')
    await expect(service.configure({ selectedCalendarIds: ['removed'], destinationCalendarId: null })).rejects.toThrow('새로고침')
  })
  test('exports are serialized and repeat exports carry the existing identifier', async () => {
    const { service, native } = fixture()
    await service.connect()
    await Promise.all([service.exportTask(task.id), service.exportTask(task.id)])
    expect(native.export.mock.calls[0]?.[0]).toMatchObject({ eventId: null, start: '2026-09-22', end: '2026-09-23', allDay: true })
    expect(native.export.mock.calls[1]?.[0]).toMatchObject({ eventId: 'event-1' })
  })
  test('a failed configuration write keeps the previous configuration', async () => {
    const { service, save } = fixture()
    await service.connect()
    save.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(service.configure({ selectedCalendarIds: [], destinationCalendarId: null })).rejects.toThrow('disk full')
    expect((await service.state()).selectedCalendarIds).toHaveLength(2)
  })
  test('disconnect never deletes events and blocks future exports', async () => {
    const { service, native } = fixture()
    await service.connect()
    await service.disconnect()
    await expect(service.exportTask(task.id)).rejects.toThrow('연결')
    expect(native.export).not.toHaveBeenCalled()
  })
  test('permission revocation is reported without returning stale data', async () => {
    const { service, native } = fixture()
    await service.connect()
    native.state.mockResolvedValue({ authorization: 'denied', calendars: [], defaultCalendarId: null })
    await expect(service.events({ from: '2026-09-01', to: '2026-10-01' })).rejects.toThrow('접근 권한')
    expect(native.events).not.toHaveBeenCalled()
  })
  test('validates bounds and rejects deleted tasks', async () => {
    const { service } = fixture({ connected: true })
    await expect(service.events({ from: 'bad', to: '2026-10-01' })).rejects.toThrow('범위')
    await expect(service.events({ from: '2026-09-01', to: '2026-08-01' })).rejects.toThrow('범위')
    await expect(service.exportTask('removed')).rejects.toThrow('찾을 수')
  })
  test('drops in-flight events after disconnect', async () => {
    const { service, native } = fixture()
    await service.connect()
    let finish!: (events: AppleCalendarEvent[]) => void
    native.events.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const result = service.events({ from: '2026-09-01', to: '2026-10-01' })
    await vi.waitFor(() => expect(native.events).toHaveBeenCalled())
    await service.disconnect()
    finish([{ id: 'private' } as AppleCalendarEvent])
    expect(await result).toEqual([])
  })
})

describe('external calendar day layout', () => {
  const days = calendarMonthGrid(new Date(2026, 8, 1)).days
  const event: AppleCalendarEvent = { id: 'e', calendarId: 'c', title: '여행', start: '2026-09-21', end: '2026-09-23', allDay: true, location: '', calendarTitle: '개인', color: '#123456', bandalTaskId: null }
  test('all-day ranges have an exclusive end without UTC conversion', () => {
    const grouped = appleEventsByDay([event], days, new Set())
    expect([...grouped.keys()]).toEqual(['2026-09-21', '2026-09-22'])
  })
  test('overnight events span both local days', () => {
    const grouped = appleEventsByDay([{ ...event, allDay: false, start: new Date(2026, 8, 21, 23).toISOString(), end: new Date(2026, 8, 22, 1).toISOString() }], days, new Set())
    expect([...grouped.keys()]).toEqual(['2026-09-21', '2026-09-22'])
  })
  test('an exported event is hidden only when its original task is visible', () => {
    expect(appleEventsByDay([{ ...event, bandalTaskId: task.id }], days, new Set([task.id])).size).toBe(0)
    expect(appleEventsByDay([{ ...event, bandalTaskId: task.id }], days, new Set()).size).toBe(2)
  })
})
