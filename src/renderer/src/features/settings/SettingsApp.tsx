/**
 * M0 placeholder settings window content: working theme picker only.
 */

import { useEffect } from 'react'
import type { ThemePreference } from '../../../../shared/types/settings'
import { useUiStore } from '../../stores/uiStore'
import './settings-app.css'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: '다크' },
  { value: 'light', label: '라이트' },
  { value: 'system', label: '시스템 설정 따르기' }
]

export function SettingsApp(): JSX.Element {
  const themePreference = useUiStore((s) => s.themePreference)
  const initTheme = useUiStore((s) => s.initTheme)
  const setThemePreference = useUiStore((s) => s.setThemePreference)

  useEffect(() => {
    void initTheme()
  }, [initTheme])

  return (
    <div className="settings-app">
      <header className="settings-app__titlebar titlebar-drag">
        <h1 className="settings-app__title">설정</h1>
      </header>
      <main className="settings-app__content">
        <section
          className="settings-section"
          aria-labelledby="settings-theme-heading"
        >
          <h2 id="settings-theme-heading" className="settings-section__heading">
            테마
          </h2>
          <div
            className="theme-options"
            role="radiogroup"
            aria-labelledby="settings-theme-heading"
          >
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={themePreference === option.value}
                className={
                  themePreference === option.value
                    ? 'theme-option theme-option--active'
                    : 'theme-option'
                }
                onClick={() => void setThemePreference(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
