import { afterEach, describe, expect, test, vi } from 'vitest'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { workspaceKey } from '../../../src/shared/types/workspace'
import { workspaceWindowKey } from '../../../src/shared/workspaceWindows'

const fixture = vi.hoisted(() => ({
  tabs: [] as any[], liveTabs: null as any[] | null, nav: {} as Record<string, { url: string }>, courseId: null as string | null,
  activeBrowserId: null as string | null, priorPanel: null as string | null,
  aiOpen: false, workspace: null as any, windowId: 'main', liveWindowKey: null as string | null,
  selectCourse: vi.fn(), close: vi.fn(), closeTemporary: vi.fn(), activate: vi.fn(), settings: vi.fn(), toast: vi.fn(), showAssistant: vi.fn(), showWorkspaceWindow: vi.fn(), lookupWindow: vi.fn(), closeSettings: vi.fn()
}))
function currentWorkspaceKey(): string | null { return fixture.workspace ? workspaceKey(fixture.workspace) : fixture.courseId }
function currentWindowKey(): string | null {
  const base = currentWorkspaceKey()
  return base === null ? null : workspaceWindowKey(base, fixture.windowId)
}
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => ({ selectCourse: (id: string | null, options?: unknown) => { fixture.selectCourse(id, options); fixture.courseId = id } }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  retainedTabDescriptors: () => fixture.tabs,
  workspaceApiForWindow: (key: string | null) => {
    fixture.lookupWindow(key)
    return key === fixture.liveWindowKey ? { panels: (fixture.liveTabs ?? fixture.tabs).map(descriptor => ({ params: { descriptor }, api: { close: fixture.closeTemporary } })) } : null
  },
  useWorkspaceStore: { getState: () => ({ surface: 'course', activeWorkspaceKey: currentWorkspaceKey(), activeWindowKey: currentWindowKey(), activeWindowId: fixture.courseId === null ? null : fixture.windowId,
    activeCourseId: fixture.courseId, activeWorkspace: fixture.workspace ?? (fixture.courseId ? { kind: 'course', courseId: fixture.courseId } : null),
    showWorkspaceWindow: (scope: any, windowId: string) => { fixture.showWorkspaceWindow(scope, windowId); fixture.workspace = scope; fixture.courseId = scope.courseId; fixture.windowId = windowId },
    activePanelSource: () => fixture.priorPanel ? { panelId: fixture.priorPanel } : null, activeBrowserTabId: () => fixture.activeBrowserId, closeTabsMatching: fixture.close, activatePanel: fixture.activate, notifyLayoutChanged: vi.fn() }) }
}))
vi.mock('../../../src/renderer/src/features/browser/browserGuestsStore', () => ({ useBrowserGuests: { getState: () => ({ nav: fixture.nav }) } }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: { getState: () => ({ openSettings: fixture.settings, closeSettings: fixture.closeSettings, showAssistant: fixture.showAssistant, rightRailOpen: fixture.aiOpen, rightRailTab: 'ai' }) } }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: fixture.toast }))
import { agentLoginOpenGuard, isAgentLoginOpenAllowed, getAgentLoginForTab, installAgentLoginTabLifecycle, isLoginTabUrl, prepareAgentLoginTab } from '../../../src/renderer/src/features/browser/agentLoginTabs'
import { resetAgentConnectionsForTests, useAgentConnectionStore } from '../../../src/renderer/src/features/chat/agentConnectionStore'
let stop: (() => void) | undefined
let progress: ((payload: any) => void) | undefined
const url = 'https://auth.openai.com/oauth/authorize?state=ephemeral'
function begin() {
  setIpcAdapter({ invoke: vi.fn(), on: (_channel: string, cb: (payload: any) => void) => { progress = cb; return () => undefined } } as unknown as IpcAdapter)
  stop = installAgentLoginTabLifecycle()
  fixture.liveWindowKey = currentWindowKey()
  const payload = { url, isPrivate: true, loginProvider: 'codex' as const, loginRequestId: 'attempt' }
  const result = prepareAgentLoginTab(payload, 'owned-tab')
  fixture.tabs = [{ kind: 'browser', payload: { tabId: result.tabId, initialUrl: url, isPrivate: true } }]
  fixture.activeBrowserId = 'owned-tab'
  return payload
}
afterEach(() => { stop?.(); stop = undefined; fixture.tabs = []; fixture.liveTabs = null; fixture.nav = {}; fixture.courseId = null; fixture.activeBrowserId = null; fixture.priorPanel = null; fixture.aiOpen = false; fixture.workspace = null; fixture.windowId = 'main'; fixture.liveWindowKey = null; vi.clearAllMocks(); resetAgentConnectionsForTests(); setIpcAdapter(null) })
describe('managed login tabs', () => {
  test('finishes a live login panel before its next-frame retained snapshot has been published', () => {
    begin(); fixture.liveTabs = fixture.tabs; fixture.tabs = []
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.closeTemporary).toHaveBeenCalledOnce()
    expect(fixture.settings).toHaveBeenCalledWith('ai')
  })

  test('terminal requests reject late open pushes and keep queued opens revoked after bounded history is evicted', () => {
    const payload = begin(), queued = agentLoginOpenGuard(payload)!
    expect(queued()).toBe(true)
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(isAgentLoginOpenAllowed(payload)).toBe(false)
    expect(isAgentLoginOpenAllowed({ url, openerTabId: 'owned-tab' })).toBe(false)
    expect(isAgentLoginOpenAllowed({ url: 'https://example.com/ordinary' })).toBe(true)
    for (let i = 0; i < 140; i++) progress!({ provider: 'codex', requestId: `later-${i}`, stage: 'cancelled' })
    expect(queued()).toBe(false)
  })
  test('completion received before the open push rejects only that provider request', () => {
    begin()
    progress!({ provider: 'codex', requestId: 'not-open-yet', stage: 'done' })
    expect(isAgentLoginOpenAllowed({ url, loginProvider: 'codex', loginRequestId: 'not-open-yet' })).toBe(false)
    expect(isAgentLoginOpenAllowed({ url, loginProvider: 'codex', loginRequestId: 'next-attempt' })).toBe(true)
  })
  test('returns to the global assistant when sign-in started without a central document panel', () => {
    fixture.aiOpen = true; fixture.courseId = 'course'; fixture.workspace = { kind: 'course', courseId: 'course' }; begin()
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.showAssistant).toHaveBeenCalledOnce()
    expect(fixture.settings).not.toHaveBeenCalled()
  })
  test('does not steal focus after the user changed the project during sign-in', () => {
    fixture.aiOpen = true; fixture.courseId = 'course'; fixture.workspace = { kind: 'project', courseId: 'course', rootRelPath: 'one' }; begin()
    fixture.workspace = { kind: 'project', courseId: 'course', rootRelPath: 'two' }
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.showAssistant).not.toHaveBeenCalled(); expect(fixture.settings).not.toHaveBeenCalled()
  })
  test('reopens the same private tab and leaves no-course users in AI settings after cancellation', () => {
    const payload = begin()
    expect(prepareAgentLoginTab(payload, 'duplicate')).toEqual({ tabId: 'owned-tab', courseId: null })
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'cancelled' })
    expect(fixture.closeTemporary).toHaveBeenCalledOnce()
    expect(fixture.settings).toHaveBeenCalledWith('ai')
    expect(fixture.toast).not.toHaveBeenCalled()
  })
  test('reopening after switching courses selects the owning course and keeps the existing panel', () => {
    fixture.courseId = 'course-a'
    const payload = begin()
    fixture.courseId = 'course-b'
    expect(prepareAgentLoginTab(payload, 'duplicate')).toEqual({ tabId: 'owned-tab', courseId: 'course-a' })
    expect(fixture.selectCourse).toHaveBeenCalledExactlyOnceWith('course-a', { preserveSurface: true })
    expect(fixture.showWorkspaceWindow).toHaveBeenCalledExactlyOnceWith({ kind: 'course', courseId: 'course-a' }, 'main')
    expect(fixture.courseId).toBe('course-a')
  })
  test('reopening from a sibling project returns to the exact owning project before focusing its login tab', () => {
    const original = { kind: 'project', courseId: 'course-a', rootRelPath: 'first' }
    fixture.courseId = 'course-a'; fixture.workspace = original
    const payload = begin()
    fixture.workspace = { ...original, rootRelPath: 'second' }
    expect(prepareAgentLoginTab(payload, 'duplicate')).toEqual({ tabId: 'owned-tab', courseId: 'course-a' })
    expect(fixture.showWorkspaceWindow).toHaveBeenCalledExactlyOnceWith(original, 'main')
    expect(fixture.selectCourse).toHaveBeenCalledExactlyOnceWith('course-a', { preserveSurface: true })
  })
  test('reopening from a sibling window selects the exact owning window before focusing its retained login tab', () => {
    const original = { kind: 'project' as const, courseId: 'course-a', rootRelPath: 'first' }
    fixture.courseId = original.courseId; fixture.workspace = original; fixture.windowId = 'login-window'
    const payload = begin(), ownedKey = workspaceWindowKey(workspaceKey(original), 'login-window')
    fixture.windowId = 'working-window'
    expect(prepareAgentLoginTab(payload, 'duplicate')).toEqual({ tabId: 'owned-tab', courseId: 'course-a' })
    expect(fixture.lookupWindow).toHaveBeenCalledWith(ownedKey)
    expect(fixture.showWorkspaceWindow).toHaveBeenCalledExactlyOnceWith(original, 'login-window')
    expect(fixture.windowId).toBe('login-window')
  })
  test('completion in a sibling window closes the owned login tab without restoring focus or settings there', () => {
    fixture.courseId = 'course'; fixture.workspace = { kind: 'course', courseId: 'course' }; fixture.windowId = 'login-window'; fixture.priorPanel = 'chat:original'
    begin()
    fixture.windowId = 'working-window'
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.lookupWindow).toHaveBeenCalledWith(workspaceWindowKey('course', 'login-window'))
    expect(fixture.close).toHaveBeenCalledExactlyOnceWith(fixture.tabs[0])
    expect(fixture.showWorkspaceWindow).not.toHaveBeenCalled()
    expect(fixture.activate).not.toHaveBeenCalled()
    expect(fixture.settings).not.toHaveBeenCalled()
    expect(fixture.windowId).toBe('working-window')
  })
  test('completion from settings does not reopen settings in a sibling project', () => {
    fixture.courseId = 'course-a'; fixture.workspace = { kind: 'project', courseId: 'course-a', rootRelPath: 'first' }; begin()
    fixture.workspace = { kind: 'project', courseId: 'course-a', rootRelPath: 'second' }
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.settings).not.toHaveBeenCalled(); expect(fixture.activate).not.toHaveBeenCalled()
  })
  test('keeps popup identity while inheriting its managed OAuth request for external fallback', () => {
    begin()
    const popup = prepareAgentLoginTab({ url: 'https://accounts.google.com/v3/signin', openerTabId: 'owned-tab', tabId: 'native-popup', isPrivate: true }, 'native-popup')
    expect(popup.tabId).toBe('native-popup')
    expect(getAgentLoginForTab('native-popup')).toEqual({ provider: 'codex', requestId: 'attempt' })
    expect(getAgentLoginForTab('ordinary-tab')).toBeNull()
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'cancelled' })
    expect(getAgentLoginForTab('native-popup')).toBeNull()
  })
  test('returns no-course users to setup when sign-in fails or expires', () => {
    begin()
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'error', message: '로그인이 만료됐어요.' })
    expect(fixture.closeTemporary).toHaveBeenCalledOnce()
    expect(fixture.settings).toHaveBeenCalledWith('ai')
    expect(fixture.toast).not.toHaveBeenCalled()
  })
  test('restores the original chat and reports success only after availability is verified', () => {
    fixture.priorPanel = 'chat:course:conversation'; fixture.courseId = 'course'; begin()
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.activate).toHaveBeenCalledWith('chat:course:conversation')
    expect(fixture.toast).not.toHaveBeenCalled()
    useAgentConnectionStore.setState(state => ({ connections: { ...state.connections, codex: { ...state.connections.codex, stage: 'idle', availability: { installed: true, loggedIn: true } } } }))
    expect(fixture.toast).toHaveBeenCalledOnce()
  })
  test('does not close a repurposed tab or a different login attempt', () => {
    begin(); fixture.nav['owned-tab'] = { url: 'https://example.com/my-notes' }
    progress!({ provider: 'codex', requestId: 'older-attempt', stage: 'done' })
    progress!({ provider: 'codex', requestId: 'attempt', stage: 'done' })
    expect(fixture.close).not.toHaveBeenCalled()
    expect(fixture.closeTemporary).not.toHaveBeenCalled()
    expect(fixture.activate).not.toHaveBeenCalled()
    expect(isAgentLoginOpenAllowed({ url: 'https://example.com/new-page', openerTabId: 'owned-tab' })).toBe(true)
  })
  test('preserves a local app tab when it no longer matches the OAuth callback', () => {
    begin()
    prepareAgentLoginTab({ url: `${url}&redirect_uri=${encodeURIComponent('http://127.0.0.1:1455/auth/callback')}`, loginProvider: 'codex', loginRequestId: 'new-attempt', isPrivate: true }, 'owned-tab')
    fixture.nav['owned-tab'] = { url: 'http://127.0.0.1:3000/my-unsaved-work' }
    progress!({ provider: 'codex', requestId: 'new-attempt', stage: 'done' })
    expect(fixture.closeTemporary).not.toHaveBeenCalled()
    expect(fixture.settings).not.toHaveBeenCalled()
  })
  test('recognizes Codex completion only on the captured loopback port', () => {
    const origin = 'https://auth.openai.com', callback = 'http://localhost:1455/auth/callback'
    expect(isLoginTabUrl(origin, 'http://localhost:1455/success?code=private', callback, 'codex')).toBe(true)
    expect(isLoginTabUrl(origin, 'http://127.0.0.1:1455/success?code=private', callback, 'codex')).toBe(true)
    expect(isLoginTabUrl(origin, 'http://127.0.0.1:3000/success', callback, 'codex')).toBe(false)
    expect(isLoginTabUrl(origin, 'http://127.0.0.1:1455/my-work', callback, 'codex')).toBe(false)
    expect(isLoginTabUrl('https://claude.com', 'http://127.0.0.1:1455/success', callback, 'claude-code')).toBe(false)
    expect(isLoginTabUrl(origin, 'http://127.0.0.1:1455/success', callback)).toBe(false)
  })
  test('recognizes OAuth origin and loopback completion without accepting lookalike hosts', () => {
    expect(isLoginTabUrl('https://auth.openai.com', 'https://auth.openai.com/callback')).toBe(true)
    expect(isLoginTabUrl('https://auth.openai.com', 'http://127.0.0.1:1455/auth/callback', 'http://127.0.0.1:1455/auth/callback')).toBe(true)
    expect(isLoginTabUrl('https://auth.openai.com', 'http://127.0.0.1:3000/my-work', 'http://127.0.0.1:1455/auth/callback')).toBe(false)
    expect(isLoginTabUrl('https://auth.openai.com', 'http://127.0.0.1:1455/my-work', 'http://127.0.0.1:1455/auth/callback')).toBe(false)
    expect(isLoginTabUrl('https://auth.openai.com', 'https://auth.openai.com.evil.test/')).toBe(false)
    expect(isLoginTabUrl('https://claude.ai', 'https://platform.claude.com/oauth/code?code=secret')).toBe(true)
    expect(isLoginTabUrl('https://claude.com', 'https://platform.claude.com/oauth/code/callback?code=secret')).toBe(true)
    expect(isLoginTabUrl('https://claude.com', 'https://platform.claude.com/oauth/code/success?app=claude-code')).toBe(true)
    expect(isLoginTabUrl('https://claude.ai', 'https://platform.claude.com/dashboard')).toBe(false)
    expect(isLoginTabUrl('https://claude.ai', 'https://claude.ai/chat/conversation')).toBe(false)
    expect(isLoginTabUrl('https://claude.ai', 'https://claude.ai/oauth/authorize')).toBe(true)
    expect(isLoginTabUrl('https://claude.com', 'https://claude.com/cai/oauth/authorize')).toBe(true)
    expect(isLoginTabUrl('https://claude.com', 'https://claude.com/product')).toBe(false)
  })
})
