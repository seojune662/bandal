import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BANDAL_DARK_COLORS,
  ICON_BASES,
  ICON_PALETTES,
  compareIconManifest,
  deriveIconColors,
  iconSvg
} from '../../scripts/generate-icon.mjs'
import {
  contrast,
  parseColor,
  readSwatches
} from '../../scripts/lib/color.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PALETTES_DIR = join(
  ROOT,
  'src/renderer/src/styles/palettes'
)

describe('brand icon palettes', () => {
  it('derives a 3:1 moon/background contrast for all eight variants', () => {
    const swatches = readSwatches(ICON_PALETTES, PALETTES_DIR)
    const ratios = new Map<string, number>()

    for (const palette of ICON_PALETTES) {
      for (const base of ICON_BASES) {
        const id = `${palette}-${base}`
        const bg = swatches.get(`--swatch-${id}-bg`)
        const accent = swatches.get(`--swatch-${id}-accent`)
        expect(bg, `${id} background swatch`).toBeDefined()
        expect(accent, `${id} accent swatch`).toBeDefined()

        const colors = deriveIconColors({ bg, accent, base })
        ratios.set(
          id,
          contrast(parseColor(colors.bg), parseColor(colors.accent))
        )
      }
    }

    expect(ratios.size).toBe(8)
    for (const [id, ratio] of ratios) {
      expect(ratio, id).toBeGreaterThanOrEqual(3)
    }
  })

  it('pins bandal-dark to the released literal colors', () => {
    expect(BANDAL_DARK_COLORS).toEqual({
      bg: '#09101e',
      bgTop: '#18223c',
      bgMid: '#0d1526',
      accent: '#f5c97b',
      accentLight: '#fbe3ae',
      accentDark: '#dda255',
      craterDark: '#c99a4e',
      craterLight: '#e8bd72',
      darkFill: ['#202c4d', '#1a2542', '#16203a'],
      star: '#dbe4f5'
    })

    expect(iconSvg(1024, BANDAL_DARK_COLORS)).toBe(
      readFileSync(join(ROOT, 'resources/icon.svg'), 'utf8')
    )
  })
})

describe('brand icon manifest comparison', () => {
  const expected = {
    version: 1,
    variants: {
      'bandal-dark': { colorsHash: 'current-bandal' },
      'ink-light': { colorsHash: 'current-ink' }
    }
  }

  it('accepts matching color hashes', () => {
    expect(compareIconManifest(expected, structuredClone(expected))).toEqual([])
  })

  it('returns the missing and changed variant ids', () => {
    expect(
      compareIconManifest(expected, {
        version: 1,
        variants: {
          'bandal-dark': { colorsHash: 'stale-bandal' }
        }
      })
    ).toEqual(['bandal-dark', 'ink-light'])
  })

  it('marks every variant stale when the manifest version changes', () => {
    expect(
      compareIconManifest(expected, { version: 2, variants: {} })
    ).toEqual(['bandal-dark', 'ink-light'])
  })
})
