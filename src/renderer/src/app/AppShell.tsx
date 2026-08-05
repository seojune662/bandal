/**
 * M0 placeholder shell: 3-region layout (left rail / center / right rail).
 * Real course list, workspace (dockview), and materials tree land in M1+.
 */

import { useEffect } from 'react'
import { openSettingsWindow } from '../lib/ipc'
import { useUiStore } from '../stores/uiStore'
import './app-shell.css'

export function AppShell(): JSX.Element {
  const resolvedTheme = useUiStore((s) => s.resolvedTheme)
  const initTheme = useUiStore((s) => s.initTheme)
  const setThemePreference = useUiStore((s) => s.setThemePreference)

  useEffect(() => {
    void initTheme()
  }, [initTheme])

  const toggleTheme = (): void => {
    void setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="app-shell">
      <header className="app-titlebar titlebar-drag">
        <span className="app-titlebar__wordmark">
          <span className="half-moon" aria-hidden="true">
            ◗
          </span>
          BANDAL
        </span>
        {/* Temporary M0 controls — replaced by real chrome later. */}
        <button type="button" className="icon-button" onClick={toggleTheme}>
          {resolvedTheme === 'dark' ? '라이트 모드' : '다크 모드'}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void openSettingsWindow()}
        >
          설정
        </button>
      </header>

      <aside
        className="app-rail app-rail--left"
        aria-label="과목 목록"
      >
        <div className="app-rail__header">
          <h2 className="app-rail__title">과목</h2>
        </div>
        <div className="app-rail__body">
          <div className="empty-state">
            <span className="empty-state__glyph" aria-hidden="true">
              ◗
            </span>
            <p className="empty-state__text">첫 과목을 만들어보세요</p>
            <p className="empty-state__hint">
              과목마다 자료·노트·AI 대화가 한곳에 모여요
            </p>
          </div>
        </div>
      </aside>

      <main className="app-workspace" aria-label="작업 공간">
        <div className="workspace-placeholder">
          <div className="workspace-placeholder__moon" aria-hidden="true" />
          <h1 className="workspace-placeholder__title">반달</h1>
          <p className="workspace-placeholder__subtitle">
            과목을 선택하면 작업 공간이 열립니다
          </p>
        </div>
      </main>

      <aside
        className="app-rail app-rail--right"
        aria-label="자료"
      >
        <div className="app-rail__header">
          <h2 className="app-rail__title">자료</h2>
        </div>
        <div className="app-rail__body">
          <div className="empty-state">
            <p className="empty-state__text">아직 자료가 없어요</p>
            <p className="empty-state__hint">
              PDF·강의노트를 끌어다 놓으면 여기에 정리돼요
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}
