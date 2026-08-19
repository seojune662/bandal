/**
 * Guards the contract for adding a theme *or* a palette (src/shared/theme.ts):
 * a registry entry and a token block must always exist together, every palette
 * must publish the picker's swatch table, and a palette may only override
 * modes that exist.
 *
 * These are cheap structural checks. The resolved (palette × mode) contrast
 * ratios are measured by `node scripts/check-contrast.mjs`, and the table it
 * produces lives in docs/STYLEGUIDE.md §1.2.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PALETTE_ID,
  DEFAULT_THEME_ID,
  PALETTES,
  SYSTEM_THEME,
  THEMES,
  getPalette,
  getTheme,
  isPaletteId,
  isThemeId,
  resolveWindowBackground
} from '../../src/shared/theme'

const STYLES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/renderer/src/styles'
)
const THEMES_DIR = join(STYLES_DIR, 'themes')
const PALETTES_DIR = join(STYLES_DIR, 'palettes')

function themeCss(): string {
  // Every theme file is reachable from the single aggregator, which is what
  // tokens.css imports. Concatenating them mirrors what the browser sees.
  const index = readFileSync(join(THEMES_DIR, 'index.css'), 'utf8')
  const files = [...index.matchAll(/@import\s+'\.\/([\w.-]+)';/g)].map((m) => m[1]!)
  return files.map((f) => readFileSync(join(THEMES_DIR, f), 'utf8')).join('\n')
}

const CSS = themeCss()

function paletteCss(): string {
  const index = readFileSync(join(PALETTES_DIR, 'index.css'), 'utf8')
  const files = [...index.matchAll(/@import\s+'\.\/([\w.-]+)';/g)].map((m) => m[1]!)
  return files.map((f) => readFileSync(join(PALETTES_DIR, f), 'utf8')).join('\n')
}

const PALETTE_CSS = paletteCss()

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
    expect(resolveWindowBackground('system', 'bandal', true)).toBe(
      getTheme(SYSTEM_THEME.dark).windowBackground
    )
    expect(resolveWindowBackground('system', 'bandal', false)).toBe(
      getTheme(SYSTEM_THEME.light).windowBackground
    )
  })

  it('gives every theme a Korean name, a usage line and a hex background', () => {
    for (const theme of THEMES) {
      expect(theme.name, theme.id).toMatch(/[가-힣]/)
      expect(theme.description.length, theme.id).toBeGreaterThan(10)
      expect(theme.windowBackground, theme.id).toMatch(/^#[0-9a-f]{6}$/)
      expect(resolveWindowBackground(theme.id, 'bandal', true)).toBe(
        theme.windowBackground
      )
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

  it('has no theme css block without a registry entry', () => {
    const declared = [...CSS.matchAll(/:root\[data-theme='([\w-]+)'\]/g)].map(
      (m) => m[1]!
    )
    for (const id of new Set(declared)) {
      expect(isThemeId(id), `${id} has css but no THEMES entry`).toBe(true)
    }
  })
})

describe('palette registry', () => {
  it('has unique ids and a valid default', () => {
    const ids = PALETTES.map((palette) => palette.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(isPaletteId(DEFAULT_PALETTE_ID)).toBe(true)
    expect(getPalette(DEFAULT_PALETTE_ID).id).toBe(DEFAULT_PALETTE_ID)
  })

  it('rejects unknown ids', () => {
    expect(isPaletteId('solarized')).toBe(false)
    expect(isPaletteId('system')).toBe(false)
    expect(isPaletteId(undefined)).toBe(false)
  })

  it('gives every palette a Korean name and a usage line', () => {
    for (const palette of PALETTES) {
      expect(palette.name, palette.id).toMatch(/[가-힣]/)
      expect(palette.description.length, palette.id).toBeGreaterThan(10)
    }
  })

  it('declares a window background for exactly the modes it re-cuts', () => {
    // A registered background with no surface override (or the reverse) is the
    // drift that shows as a flash of the wrong color on launch.
    for (const palette of PALETTES) {
      for (const theme of THEMES) {
        const declared = palette.windowBackground[theme.id]
        const overrides = new RegExp(
          `:root\\[data-palette='${palette.id}'\\]\\[data-theme='${theme.id}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`
        )
          .exec(PALETTE_CSS)?.[1]
          ?.includes('--bg-app:')
        expect(
          declared !== undefined,
          `${palette.id} × ${theme.id}: windowBackground ${declared === undefined ? 'missing' : 'declared'} but --bg-app ${overrides === true ? 'overridden' : 'not overridden'}`
        ).toBe(overrides === true)
        if (declared !== undefined) {
          expect(declared, `${palette.id} × ${theme.id}`).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })

  it('resolves the window background through the palette, then the mode', () => {
    for (const palette of PALETTES) {
      for (const theme of THEMES) {
        expect(
          resolveWindowBackground(theme.id, palette.id, true),
          `${palette.id} × ${theme.id}`
        ).toBe(palette.windowBackground[theme.id] ?? theme.windowBackground)
      }
    }
  })
})

describe('palette css files', () => {
  /** Every (palette, mode) cell the Appearance picker can render a card for. */
  const SWATCH_KEYS = ['bg', 'surface', 'text', 'accent'] as const

  it('exports the full swatch table', () => {
    for (const palette of PALETTES) {
      for (const theme of THEMES) {
        for (const key of SWATCH_KEYS) {
          const name = `--swatch-${palette.id}-${theme.id}-${key}`
          expect(PALETTE_CSS, `missing ${name}`).toContain(`${name}:`)
        }
      }
    }
  })

  it('only overrides modes that are registered', () => {
    const declared = [
      ...PALETTE_CSS.matchAll(
        /:root\[data-palette='([\w-]+)'\]\[data-theme='([\w-]+)'\]/g
      )
    ]
    expect(declared.length).toBeGreaterThan(0)
    for (const [, paletteId, themeId] of declared) {
      expect(isPaletteId(paletteId), `${paletteId} has css but no PALETTES entry`)
        .toBe(true)
      expect(isThemeId(themeId), `${themeId} has css but no THEMES entry`)
        .toBe(true)
    }
  })

  it('leaves content colors to the mode layer', () => {
    // --course-*, --highlight-*, --status-* and --danger* identify content, so
    // a course tagged 초록 must look the same in every palette (STYLEGUIDE §1.4).
    const reserved = /--(course|highlight|status|danger)[\w-]*\s*:/g
    for (const match of PALETTE_CSS.matchAll(reserved)) {
      expect.fail(`palette css assigns a mode-owned token: ${match[0]}`)
    }
  })
})
