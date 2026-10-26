// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })

const state = vi.hoisted(() => ({
  workspace: {
    activeWorkspace: { kind: 'course', courseId: 'course-1' } as { kind: string; courseId: string } | null,
    surface: 'course', workspaceChromeMode: 'all', windowsOverviewOpen: false,
    setWorkspaceChromeMode: vi.fn(), showWorkspace: vi.fn()
  },
  ui: {
    rightRailOpen: true, rightRailTab: 'materials', isSettingsOpen: false,
    isBoardOverlayOpen: false, isLinkGraphOpen: false,
    closeSettings: vi.fn(), closeBoardOverlay: vi.fn(), closeLinkGraph: vi.fn(),
    setRightRailTab: vi.fn(), toggleRightRail: vi.fn()
  },
  overview: vi.fn(), shortcutMounts: 0
}))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: Object.assign((select: (value: typeof state.workspace) => unknown) => select(state.workspace), { getState: () => state.workspace }) }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: Object.assign((select: (value: typeof state.ui) => unknown) => select(state.ui), { getState: () => state.ui }) }))
vi.mock('../../../src/renderer/src/features/workspace/windowOverviewController', () => ({ toggleWindowOverview: state.overview }))
vi.mock('../../../src/renderer/src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../../src/renderer/src/features/university/UniversityShortcuts', () => ({ UniversityShortcuts: () => <div aria-label="학교 바로가기">학교</div> }))
vi.mock('../../../src/renderer/src/features/ai/AiShortcuts', async () => {
  const { useState } = await import('react')
  return { AiShortcuts: () => {
    const [expanded, setExpanded] = useState(() => { state.shortcutMounts++; return false })
    return <button aria-label="AI 바로가기" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>AI</button>
  } }
})
import { WorkspaceControls } from '../../../src/renderer/src/app/WorkspaceControls'
import { HomeSidebar } from '../../../src/renderer/src/app/HomeSidebar'
let container: HTMLDivElement, root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  state.shortcutMounts = 0
  Object.assign(state.workspace, { activeWorkspace: { kind: 'course', courseId: 'course-1' }, surface: 'course', workspaceChromeMode: 'all', windowsOverviewOpen: false })
  Object.assign(state.ui, { rightRailOpen: true, isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
function click(label: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  act(() => button!.click())
}
test('keeps the three controls in the requested order and offers all chrome modes', () => {
  act(() => root.render(<WorkspaceControls />))
  expect([...container.querySelectorAll('.workspace-controls > button')].map(button => button.getAttribute('aria-label'))).toEqual(['탭 바와 도구 모음 표시', '윈도우 관리', '오른쪽 사이드바 접기'])
  click('탭 바와 도구 모음 표시')
  const options = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
  expect(options.map(button => button.textContent?.replace('✓', ''))).toEqual(['모두 표시', '탭 바만 숨기기', '탭 바와 도구 모음 숨기기'])
  expect(options[0].getAttribute('aria-checked')).toBe('true')
  act(() => options[2].click())
  expect(state.workspace.setWorkspaceChromeMode).toHaveBeenCalledWith('all-hidden')
  expect(container.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('탭 바와 도구 모음 표시')
  click('윈도우 관리')
  expect(state.overview).toHaveBeenCalledOnce()
})
test('right sidebar control returns from covering surfaces and opens the remembered tab', () => {
  state.workspace.surface = 'community'; state.ui.isSettingsOpen = true
  act(() => root.render(<WorkspaceControls />))
  click('오른쪽 사이드바 펼치기')
  expect(state.workspace.showWorkspace).toHaveBeenCalledWith(state.workspace.activeWorkspace)
  expect(state.ui.closeSettings).toHaveBeenCalledOnce()
  expect(state.ui.setRightRailTab).toHaveBeenCalledWith('materials')
  expect(state.ui.toggleRightRail).not.toHaveBeenCalled()
})
test('empty workspaces retain all control buttons and keep the sidebar usable', () => {
  state.workspace.activeWorkspace = null
  act(() => root.render(<WorkspaceControls />))
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('.workspace-controls > button')]
  expect(buttons).toHaveLength(3)
  expect(buttons.map(button => button.disabled)).toEqual([true, true, false])
  click('오른쪽 사이드바 접기')
  expect(state.ui.toggleRightRail).toHaveBeenCalledOnce()
})
test('school and AI remain mounted and retain expansion while switching course and project lists', () => {
  const render = (project: boolean): void => {
    act(() => root.render(<HomeSidebar hidden={false}><aside hidden={project}>과목 목록</aside><aside hidden={!project}>프로젝트 목록</aside></HomeSidebar>))
  }
  render(false)
  click('AI 바로가기')
  const shortcuts = container.querySelector('.shell-home-sidebar__shortcuts')
  render(true)
  expect(container.querySelector('.shell-home-sidebar__shortcuts')).toBe(shortcuts)
  expect(container.querySelector('[aria-label="학교 바로가기"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="AI 바로가기"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(state.shortcutMounts).toBe(1)
})
