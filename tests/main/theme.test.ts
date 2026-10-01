import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, THEMES, isThemeId, normalizeThemePreference, resolveWindowBackground, resolveWindowSymbolColor } from '../../src/shared/theme'
const THEMES_DIR = join(process.cwd(), 'src/renderer/src/styles/themes')
const REQUIRED_TOKENS = [
  'bg-app', 'bg-surface', 'bg-raised', 'bg-overlay',
  'text-primary', 'text-secondary', 'text-muted',
  'accent', 'accent-muted', 'on-accent',
  'danger', 'danger-muted', 'on-danger', 'backdrop',
  'border-subtle', 'border-strong',
  'course-gold', 'course-green', 'course-blue',
  'course-pink', 'course-violet', 'course-orange',
  'highlight-yellow', 'highlight-green', 'highlight-pink', 'highlight-blue',
  'status-todo', 'status-progress', 'status-done',
  'shadow-sm', 'shadow-md', 'shadow-lg'
]

describe('neutral appearance contract', () => {
  it('ships exactly two modes, with a system default', () => {
    expect(THEMES.map(theme => theme.id)).toEqual(['light', 'dark'])
    expect(DEFAULT_THEME_ID).toBe('system')
    expect(readdirSync(THEMES_DIR).sort()).toEqual(['dark.css', 'index.css', 'light.css'])
  })
  it.each([
    ['light', 'light'], ['sepia', 'light'], ['high-contrast', 'light'],
    ['dark', 'dark'], ['midnight', 'dark'], ['graphite', 'dark'],
    ['system', 'system'], ['future-theme', 'system'], [null, 'system']
  ])('migrates stored preference %s to %s', (previous, expected) => {
    expect(normalizeThemePreference(previous)).toBe(expected)
  })
  it('only accepts active modes as theme ids', () => {
    expect(isThemeId('light')).toBe(true)
    expect(isThemeId('dark')).toBe(true)
    expect(isThemeId('midnight')).toBe(false)
    expect(isThemeId('system')).toBe(false)
  })
  it('keeps CSS, window paint and native controls in agreement', () => {
    for (const theme of THEMES) {
      const css = readFileSync(join(THEMES_DIR, `${theme.id}.css`), 'utf8')
      for (const token of REQUIRED_TOKENS) expect(css).toContain(`--${token}:`)
      expect(css).toContain(`--bg-app: ${theme.windowBackground};`)
      expect(css).toContain(`color-scheme: ${theme.id};`)
      expect(resolveWindowBackground(theme.id, 'moss', true)).toBe(theme.windowBackground)
      expect(resolveWindowBackground('system', 'lavender', theme.id === 'dark')).toBe(theme.windowBackground)
      expect(resolveWindowSymbolColor(theme.id, false)).toBe(theme.id === 'dark' ? '#ececec' : '#0d0d0d')
    }
  })
})
