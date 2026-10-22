import { afterEach, describe, expect, test, vi } from 'vitest'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

const fixture = vi.hoisted(() => ({
  tabs: [] as any[], nav: {} as Record<string, { url: string }>, courseId: null as string | null,
  activeBrowserId: null as string | null, priorPanel: null as string | null,
  aiOpen: false, workspace: null as any,
  selectCourse: vi.fn(), close: vi.fn(), closeTemporary: vi.fn(), activate: vi.fn(), settings: vi.fn(), toast: vi.fn(), showAssistant: vi.fn(), closeSettings: vi.fn()
}))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => ({ selectCourse: (id: string | null) => { fixture.selectCourse(id); fixture.courseId = id } }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  retainedTabDescriptors: () => fixture.tabs,
  workspaceApiForCourse: () => ({ panels: fixture.tabs.map(descriptor => ({ params: { descriptor }, api: { close: fixture.closeTemporary } })) }),
  useWorkspaceStore: { getState: () => ({ surface: 'course', activeCourseId: fixture.courseId, activeWorkspace: fixture.workspace, activePanelSource: () => fixture.priorPanel ? { panelId: fixture.priorPanel } : null, activeBrowserTabId: () => fixture.activeBrowserId, closeTabsMatching: fixture.close, activatePanel: fixture.activate, notifyLayoutChanged: vi.fn() }) }
}))
vi.mock('../../../src/renderer/src/features/browser/browserGuestsStore', () => ({ useBrowserGuests: { getState: () => ({ nav: fixture.nav }) } }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: { getState: () => ({ openSettings: fixture.settings, closeSettings: fixture.closeSettings, showAssistant: fixture.showAssistant, rightRailOpen: fixture.aiOpen, rightRailTab: 'ai' }) } }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: fixture.toast }))
import { getAgentLoginForTab, installAgentLoginTabLifecycle, isLoginTabUrl, prepareAgentLoginTab } from '../../../src/renderer/src/features/browser/agentLoginTabs'
import { resetAgentConnectionsForTests, useAgentConnectionStore } from '../../../src/renderer/src/features/chat/agentConnectionStore'
let stop: (() => void) | undefined
let progress: ((payload: any) => void) | undefined
const url = 'https://auth.openai.com/oauth/authorize?state=ephemeral'
function begin() {
  setIpcAdapter({ invoke: vi.fn(), on: (_channel: string, cb: (payload: any) => void) => { progress = cb; return () => undefined } } as unknown as IpcAdapter)
  stop = installAgentLoginTabLifecycle()
  const payload = { url, isPrivate: true, loginProvider: 'codex' as const, loginRequestId: 'attempt' }
  const result = prepareAgentLoginTab(payload, 'owned-tab')
  fixture.tabs = [{ kind: 'browser', payload: { tabId: result.tabId, initialUrl: url, isPrivate: true } }]
  fixture.activeBrowserId = 'owned-tab'
  return payload
}
afterEach(() => { stop?.(); stop = undefined; fixture.tabs = []; fixture.nav = {}; fixture.courseId = null; fixture.activeBrowserId = null; fixture.priorPanel = null; fixture.aiOpen = false; fixture.workspace = null; vi.clearAllMocks(); resetAgentConnectionsForTests(); setIpcAdapter(null) })
describe('managed login tabs', () => {
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
    expect(fixture.selectCourse).toHaveBeenCalledExactlyOnceWith('course-a')
    expect(fixture.courseId).toBe('course-a')
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
