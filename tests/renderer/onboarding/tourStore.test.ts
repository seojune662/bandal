// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS, TUTORIAL_VERSION } from '../../../src/shared/types/settings'

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(), loaded: vi.fn(), push: null as null | ((event: { settings: any }) => void),
  courses: {} as any, workspace: {} as any, ui: {} as any,
  opens: [] as { descriptor: any; options: any }[], activeCalls: [] as (string | null)[],
  launcher: vi.fn(), toast: vi.fn()
}))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: fixture.invoke, onPush: (_channel: string, callback: typeof fixture.push) => { fixture.push = callback; return () => { fixture.push = null } } }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({ ensureSettingsLoaded: fixture.loaded }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => fixture.courses } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => fixture.workspace, subscribe: () => () => {} } }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: { getState: () => fixture.ui, setState: (patch: any) => Object.assign(fixture.ui, patch) } }))
vi.mock('../../../src/renderer/src/features/launcher/launcherContext', () => ({ captureLauncherContext: fixture.launcher }))
vi.mock('../../../src/renderer/src/features/workspace/tabIdentity', () => ({
  descriptorFor: (kind: string, payload: any) => ({ kind, payload }),
  tabPanelId: (d: any) => `${d.kind}:${d.payload.courseId}:${d.payload.relPath}`
}))
vi.mock('../../../src/renderer/src/i18n/localeStore', () => ({ getLocale: () => 'ko-KR' }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: fixture.toast }))
import { resetTourForTests, useTourStore } from '../../../src/renderer/src/features/onboarding/tour/tourStore'
import { TOUR_STEPS } from '../../../src/renderer/src/features/onboarding/tour/tourScript'

let settings: typeof DEFAULT_SETTINGS
let events: string[]
let failPurge: boolean
const originalPanel = 'note:original:notes.md'
const course = (id: string) => ({ id, name: id, color: '#357', folderPath: `/sample/${id}` })
const savedUi = { leftRailOpen: false, courseRailOpen: false, leftRailPanel: 'widgets', rightRailOpen: false, isSettingsOpen: true, settingsCategory: 'general', isBoardOverlayOpen: true, isLinkGraphOpen: true }

beforeEach(() => {
  resetTourForTests(); vi.resetAllMocks(); document.body.innerHTML = ''
  Object.assign(globalThis, { CSS: { escape: (value: string) => value } })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  events = []; failPurge = false; fixture.opens = []; fixture.activeCalls = []
  settings = structuredClone(DEFAULT_SETTINGS)
  settings.dataRoot = '/sample'; settings.onboarding.closedAt = '2026-10-01T00:00:00.000Z'; settings.tutorial = { seenVersion: TUTORIAL_VERSION, activeCourseId: null }
  fixture.courses = {
    courses: [course('original')], selectedCourseId: 'original',
    loadCourses: vi.fn(async () => {}),
    createCourse: vi.fn(async () => { events.push('create'); const next = course('demo'); fixture.courses.courses.push(next); return next }),
    selectCourse: vi.fn((id: string | null) => { fixture.courses.selectedCourseId = id }),
    deleteCourse: vi.fn(async (id: string) => { events.push(`delete:${id}`); fixture.courses.courses = fixture.courses.courses.filter((c: any) => c.id !== id) })
  }
  fixture.workspace = {
    activeCourseId: 'original', activePanelId: originalPanel, hydration: 'ready', surface: 'learning-home',
    openTabs: { [originalPanel]: { kind: 'note', payload: { courseId: 'original', relPath: 'notes.md' } } },
    setActiveCourse: vi.fn((id: string | null) => { fixture.activeCalls.push(id); fixture.workspace.activeCourseId = id }),
    showCourseWorkspace: vi.fn((id: string | null) => { fixture.workspace.surface = 'course'; fixture.workspace.setActiveCourse(id) }),
    showLearningHome: vi.fn(() => { fixture.workspace.surface = 'learning-home' }),
    openTab: vi.fn((descriptor: any, options: any) => { fixture.opens.push({ descriptor, options }); const id = `${descriptor.kind}:${descriptor.payload.courseId}:${descriptor.payload.relPath}`; fixture.workspace.openTabs[id] = descriptor; fixture.workspace.activePanelId = id }),
    closeTabs: vi.fn(async (ids: string[]) => { for (const id of ids) delete fixture.workspace.openTabs[id] }),
    activatePanel: vi.fn((id: string) => { fixture.workspace.activePanelId = id })
  }
  fixture.ui = { ...savedUi,
    closeSettings: () => { fixture.ui.isSettingsOpen = false }, closeBoardOverlay: () => { fixture.ui.isBoardOverlayOpen = false },
    showCourses: () => { fixture.ui.leftRailOpen = true; fixture.ui.courseRailOpen = true; fixture.ui.leftRailPanel = 'courses' },
    toggleRightRail: () => { fixture.ui.rightRailOpen = !fixture.ui.rightRailOpen }
  }
  fixture.loaded.mockImplementation(async () => settings)
  fixture.invoke.mockImplementation(async (channel: string, input: any) => {
    if (channel === 'settings:get') return settings
    if (channel === 'settings:set') { events.push(`marker:${input.tutorial.activeCourseId ?? 'clear'}`); settings = { ...settings, ...input }; return settings }
    if (channel === 'materials:writeFile') { events.push(`write:${input.encoding}`); return { relPath: input.fileName } }
    if (channel === 'courses:list') return fixture.courses.courses
    if (channel === 'courses:purge') { events.push(`purge:${input.courseId}`); if (failPurge) throw new Error('temporary purge failure'); return {} }
    throw new Error(`Unexpected IPC ${channel}`)
  })
})
afterEach(() => { resetTourForTests(); vi.useRealTimers(); vi.restoreAllMocks() })
async function next(index: number): Promise<void> { useTourStore.getState().next(); await vi.waitFor(() => { expect(useTourStore.getState().stepIndex).toBe(index); expect(useTourStore.getState().transitioning).toBe(false) }) }
async function ended(): Promise<void> { await vi.waitFor(() => expect(useTourStore.getState().status).toBe('idle')) }

describe('five-feature tutorial lifecycle', () => {
  test('seeds only a marked sample PDF and note, and duplicate starts collapse', async () => {
    await Promise.all([useTourStore.getState().start(), useTourStore.getState().start()])
    expect(fixture.courses.createCourse).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['create', 'marker:demo', 'write:utf8', 'write:base64'])
    const pdf = fixture.invoke.mock.calls.find(([channel, input]) => channel === 'materials:writeFile' && input.encoding === 'base64')![1]
    expect(atob(pdf.data).slice(0, 4)).toBe('%PDF')
    expect(fixture.opens).toHaveLength(0)
    expect(TOUR_STEPS.map(step => step.id)).toEqual(['materials', 'reading', 'assistant', 'review', 'english'])
    expect(useTourStore.getState().status).toBe('running')
    expect(fixture.workspace.surface).toBe('course')
  })

  test('uses the split documents, the current PDF sidebar, and real launcher entries without AI mutation', async () => {
    await useTourStore.getState().start(); await next(1)
    expect(fixture.opens.map(item => item.descriptor.kind)).toEqual(['pdf', 'note'])
    expect(fixture.opens[1]!.options).toEqual({ beside: true })
    const pdfPanelId = `pdf:demo:${useTourStore.getState().seedPdfPath}`
    const panel = document.createElement('div'); panel.dataset.tourPanel = pdfPanelId
    const toggle = document.createElement('button'); toggle.className = 'tab-assistant-toggle'; toggle.setAttribute('aria-expanded', 'false')
    const clicked = vi.fn(); toggle.addEventListener('click', clicked); panel.append(toggle); document.body.append(panel)
    await next(2); expect(clicked).toHaveBeenCalledTimes(1)
    await next(3); await next(4)
    expect(fixture.ui.leftRailPanel).toBe('plugins'); expect(fixture.launcher).toHaveBeenCalledTimes(2)
    expect(fixture.invoke.mock.calls.map(([channel]) => channel).filter(channel => channel.startsWith('chat:') || channel.startsWith('learning:') || channel.startsWith('study:'))).toEqual([])
  })

  test.each(['finish', 'skip'] as const)('%s removes only the sample course and restores the previous home, panel, and rails', async action => {
    await useTourStore.getState().start(); await next(1)
    useTourStore.getState()[action](); await ended()
    expect(events.slice(-3)).toEqual(['delete:demo', 'purge:demo', 'marker:clear'])
    expect(fixture.courses.courses.map((c: any) => c.id)).toEqual(['original'])
    expect(fixture.courses.selectedCourseId).toBe('original'); expect(fixture.workspace.activeCourseId).toBe('original')
    expect(fixture.workspace.activePanelId).toBe(originalPanel); expect(fixture.workspace.surface).toBe('learning-home')
    expect(fixture.ui).toMatchObject(savedUi)
    expect(fixture.workspace.openTabs).toEqual({ [originalPanel]: { kind: 'note', payload: { courseId: 'original', relPath: 'notes.md' } } })
  })

  test('a purge failure keeps the recovery marker and lets Finish retry cleanup', async () => {
    await useTourStore.getState().start(); failPurge = true
    useTourStore.getState().finish(); await vi.waitFor(() => expect(fixture.toast).toHaveBeenCalled())
    expect(useTourStore.getState().status).toBe('running'); expect(settings.tutorial.activeCourseId).toBe('demo')
    expect(events).not.toContain('marker:clear')
    failPurge = false; useTourStore.getState().finish(); await ended()
    expect(settings.tutorial.activeCourseId).toBeNull(); expect(fixture.workspace.surface).toBe('learning-home')
  })

  test('boot repairs an interrupted tour before clearing its marker', async () => {
    settings.tutorial.activeCourseId = 'leaked'; fixture.courses.courses.push(course('leaked'))
    await useTourStore.getState().init()
    expect(events).toEqual(['delete:leaked', 'purge:leaked', 'marker:clear'])
    expect(useTourStore.getState().status).toBe('idle'); expect(fixture.courses.createCourse).not.toHaveBeenCalled()
  })

  test('a failed boot repair cannot be overwritten by a second sample course', async () => {
    settings.tutorial.activeCourseId = 'leaked'; fixture.courses.courses.push(course('leaked')); failPurge = true
    await useTourStore.getState().init(); await useTourStore.getState().start()
    expect(settings.tutorial.activeCourseId).toBe('leaked'); expect(fixture.courses.createCourse).not.toHaveBeenCalled()
    failPurge = false; await useTourStore.getState().start()
    expect(events.indexOf('marker:clear')).toBeLessThan(events.indexOf('create'))
    expect(useTourStore.getState().status).toBe('running')
  })

  test.each(['skip', 'finish'] as const)('%s invalidates step setup still waiting for sample-course hydration', async action => {
    await useTourStore.getState().start()
    vi.useFakeTimers()
    fixture.workspace.showCourseWorkspace.mockImplementation((id: string | null) => {
      fixture.workspace.surface = 'course'; fixture.workspace.setActiveCourse(id)
      fixture.workspace.hydration = id === 'demo' ? 'loading' : 'ready'
    })
    useTourStore.getState().next()
    expect(useTourStore.getState().transitioning).toBe(true)
    useTourStore.getState()[action](); await ended()
    await vi.advanceTimersByTimeAsync(3_100)
    expect(fixture.opens).toEqual([])
    expect(fixture.workspace.activeCourseId).toBe('original')
    expect(fixture.workspace.activePanelId).toBe(originalPanel)
    expect(fixture.workspace.surface).toBe('learning-home')
    expect(fixture.ui).toMatchObject(savedUi)
    expect(useTourStore.getState().stepIndex).toBe(0)
  })

  test('a delayed launcher context cannot reopen the launcher after Skip restores the original view', async () => {
    await useTourStore.getState().start(); await next(1); await next(2)
    let complete!: () => void
    fixture.launcher.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve }))
    useTourStore.getState().next()
    await vi.waitFor(() => expect(fixture.launcher).toHaveBeenCalled())
    useTourStore.getState().skip(); await ended()
    complete(); await Promise.resolve(); await Promise.resolve()
    expect(fixture.ui).toMatchObject(savedUi)
    expect(useTourStore.getState()).toMatchObject({ status: 'idle', stepIndex: 0, transitioning: false })
  })

  test('replay preserves and repairs a failed boot marker before creating the new sample', async () => {
    settings.tutorial.activeCourseId = 'leaked'; fixture.courses.courses.push(course('leaked')); failPurge = true
    await useTourStore.getState().init()
    failPurge = false
    settings = { ...settings, tutorial: { ...settings.tutorial, seenVersion: 0 } }
    fixture.push?.({ settings })
    await vi.waitFor(() => expect(useTourStore.getState().status).toBe('running'))
    expect(events.indexOf('marker:clear')).toBeLessThan(events.indexOf('create'))
    expect(settings.tutorial.activeCourseId).toBe('demo')
  })

  test('a failed replay consumes only its trigger so the same session can retry', async () => {
    settings.tutorial.activeCourseId = 'leaked'; fixture.courses.courses.push(course('leaked')); failPurge = true
    await useTourStore.getState().init()
    settings = { ...settings, tutorial: { ...settings.tutorial, seenVersion: 0 } }
    fixture.push?.({ settings })
    await vi.waitFor(() => expect(fixture.toast).toHaveBeenCalled())
    expect(settings.tutorial).toEqual({ seenVersion: TUTORIAL_VERSION, activeCourseId: 'leaked' })
    expect(fixture.courses.createCourse).not.toHaveBeenCalled()
    fixture.push?.({ settings }) // The acknowledgement broadcast from settings:set.
    failPurge = false
    settings = { ...settings, tutorial: { ...settings.tutorial, seenVersion: 0 } }
    fixture.push?.({ settings })
    await vi.waitFor(() => expect(useTourStore.getState().status).toBe('running'))
    expect(fixture.courses.createCourse).toHaveBeenCalledTimes(1)
  })

  test('declining a tour with an interrupted sample purges it before acknowledging', async () => {
    settings.tutorial.activeCourseId = 'leaked'; fixture.courses.courses.push(course('leaked'))
    expect(await useTourStore.getState().later()).toBe(true)
    expect(events).toEqual(['delete:leaked', 'purge:leaked', 'marker:clear'])
    expect(fixture.courses.createCourse).not.toHaveBeenCalled()
    expect(fixture.workspace.activeCourseId).toBe('original')
    expect(fixture.workspace.surface).toBe('learning-home')
  })

  test('a failed purge while declining keeps the sample recovery marker', async () => {
    settings.tutorial.activeCourseId = 'leaked'; fixture.courses.courses.push(course('leaked')); failPurge = true
    expect(await useTourStore.getState().later()).toBe(false)
    expect(settings.tutorial.activeCourseId).toBe('leaked')
    expect(events).not.toContain('marker:clear')
    expect(useTourStore.getState().status).toBe('idle')
    expect(fixture.workspace.surface).toBe('learning-home')
  })

  test('acknowledgement preserves newer seen versions; incidental broadcasts do not replay', async () => {
    settings.tutorial.seenVersion = TUTORIAL_VERSION + 10
    await useTourStore.getState().init(); expect(useTourStore.getState().status).toBe('idle')
    expect(await useTourStore.getState().later()).toBe(true); expect(settings.tutorial.seenVersion).toBe(TUTORIAL_VERSION + 10)
    fixture.push?.({ settings }); expect(fixture.courses.createCourse).not.toHaveBeenCalled()
    fixture.push?.({ settings: { ...settings, tutorial: { seenVersion: 0, activeCourseId: null } } })
    await vi.waitFor(() => expect(useTourStore.getState().status).toBe('running'))
    expect(fixture.courses.createCourse).toHaveBeenCalledTimes(1)
  })
})
