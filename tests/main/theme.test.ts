/**
 * Guards the two-step contract for adding a theme (src/shared/theme.ts):
 * a registry entry and a token file must always exist together, and the
 * window background must mirror the theme's --bg-app.
 *
 * These are cheap structural checks; the measured WCAG ratios live in
 * docs/STYLEGUIDE.md §1.2.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_ID,
  SYSTEM_THEME,
  THEMES,
  getTheme,
  isThemeId,
  resolveWindowBackground
} from '../../src/shared/theme'

const THEMES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/renderer/src/styles/themes'
)

function themeCss(): string {
  // Every theme file is reachable from the single aggregator, which is what
  // tokens.css imports. Concatenating them mirrors what the browser sees.
  const index = readFileSync(join(THEMES_DIR, 'index.css'), 'utf8')
  const files = [...index.matchAll(/@import\s+'\.\/([\w.-]+)';/g)].map((m) => m[1]!)
  return files.map((f) => readFileSync(join(THEMES_DIR, f), 'utf8')).join('\n')
}

const CSS = themeCss()

/** Tokens every theme must assign — components read all of them. */
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

function blockFor(id: string): string {
  const match = new RegExp(
    `:root\\[data-theme='${id}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`
  ).exec(CSS)
  return match?.[1] ?? ''
}

describe('theme registry', () => {
  it('has unique ids and a valid default', () => {
    const ids = THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true)
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID)
  })

  it('rejects unknown ids', () => {
    expect(isThemeId('solarized')).toBe(false)
    expect(isThemeId('system')).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
  })

  it('maps system onto registered themes of the matching base', () => {
    expect(isThemeId(SYSTEM_THEME.dark)).toBe(true)
    expect(isThemeId(SYSTEM_THEME.light)).toBe(true)
    expect(getTheme(SYSTEM_THEME.dark).base).toBe('dark')
    expect(getTheme(SYSTEM_THEME.light).base).toBe('light')
    expect(resolveWindowBackground('system', true)).toBe(
      getTheme(SYSTEM_THEME.dark).windowBackground
    )
    expect(resolveWindowBackground('system', false)).toBe(
      getTheme(SYSTEM_THEME.light).windowBackground
    )
  })

  it('gives every theme a Korean name, a usage line and a hex background', () => {
    for (const theme of THEMES) {
      expect(theme.name, theme.id).toMatch(/[가-힣]/)
      expect(theme.description.length, theme.id).toBeGreaterThan(10)
      expect(theme.windowBackground, theme.id).toMatch(/^#[0-9a-f]{6}$/)
      expect(resolveWindowBackground(theme.id, true)).toBe(theme.windowBackground)
    }
  })
})

describe('theme css files', () => {
  it('defines a token block for every registered theme', () => {
    for (const theme of THEMES) {
      expect(blockFor(theme.id), `${theme.id}: missing :root[data-theme] block`)
        .not.toBe('')
    }
  })

  it('assigns every required token in every theme', () => {
    for (const theme of THEMES) {
      const block = blockFor(theme.id)
      for (const token of REQUIRED_TOKENS) {
        expect(block, `${theme.id} is missing --${token}`).toContain(`--${token}:`)
      }
    }
  })

  it('declares the right color-scheme for each base', () => {
    for (const theme of THEMES) {
      expect(blockFor(theme.id), theme.id).toContain(`color-scheme: ${theme.base}`)
    }
  })

  it('exports preview swatches that match the tokens they advertise', () => {
    // A drifted swatch shows the picker a palette the theme does not have.
    const mirrors: Array<[string, string]> = [
      ['bg', 'bg-app'],
      ['surface', 'bg-surface'],
      ['text', 'text-primary'],
      ['accent', 'accent']
    ]
    for (const theme of THEMES) {
      const block = blockFor(theme.id)
      for (const [key, token] of mirrors) {
        const preview = new RegExp(
          `--preview-${theme.id}-${key}:\\s*([^;]+);`
        ).exec(CSS)?.[1]
        const actual = new RegExp(`--${token}:\\s*([^;]+?)\\s*(?:;|/\\*)`).exec(
          block
        )?.[1]
        expect(preview, `${theme.id}: missing --preview-${theme.id}-${key}`)
          .toBeDefined()
        expect(preview?.trim(), `${theme.id}: preview ${key} drifted from --${token}`)
          .toBe(actual?.trim())
      }
    }
  })

  it('has no theme css block without a registry entry', () => {
    const declared = [...CSS.matchAll(/:root\[data-theme='([\w-]+)'\]/g)].map(
      (m) => m[1]!
    )
    for (const id of new Set(declared)) {
      expect(isThemeId(id), `${id} has css but no THEMES entry`).toBe(true)
    }
  })
})
