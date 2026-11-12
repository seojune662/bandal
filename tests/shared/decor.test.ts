import { expect, test } from 'vitest'
import { DECOR_PALETTES, DEFAULT_DECOR, decorMesh, decorPalette, decorVariables, oklchToRgb, sanitizeDecor } from '../../src/shared/decor'

test('OKLCH conversion matches known sRGB anchors and clips into the gamut', () => {
  expect(oklchToRgb(1, 0, 0).map(v => Math.round(v * 255))).toEqual([255, 255, 255])
  expect(oklchToRgb(0, 0, 0).map(v => Math.round(v * 255))).toEqual([0, 0, 0])
  // oklch(0.6279 0.2577 29.23) is sRGB red.
  expect(oklchToRgb(0.62796, 0.25768, 29.2339).map(v => Math.round(v * 255))).toEqual([255, 0, 0])
  for (const value of oklchToRgb(0.9, 0.4, 150)) expect(value).toBeGreaterThanOrEqual(0), expect(value).toBeLessThanOrEqual(1)
})

test('the eight iPad palettes, dawn first; unknown ids fall back to it', () => {
  expect(DECOR_PALETTES.map(p => p.id)).toEqual(['dawn', 'blossom', 'sunset', 'forest', 'ocean', 'lavender', 'ink', 'mono'])
  expect(decorPalette('nope').id).toBe('dawn')
  expect(DEFAULT_DECOR).toEqual({ palette: 'dawn', intensity: 0.55 })
})

test('mesh: lightness falls from the lit corner in both modes; mono is grey', () => {
  const luminance = ([r, g, b]: readonly number[]) => r! + g! + b!
  for (const dark of [false, true]) {
    const mesh = decorMesh(decorPalette('ocean'), dark, 0.8)
    expect(mesh).toHaveLength(9)
    expect(luminance(mesh[0]!)).toBeGreaterThan(luminance(mesh[8]!))
  }
  for (const [r, g, b] of decorMesh(decorPalette('mono'), false, 1)) { expect(Math.abs(r - g)).toBeLessThan(0.01); expect(Math.abs(g - b)).toBeLessThan(0.01) }
})

test('glass alphas follow the dial and Reduce Transparency keeps them solid', () => {
  const quiet = decorVariables({ palette: 'dawn', intensity: 0 }, false)
  const loud = decorVariables({ palette: 'dawn', intensity: 1 }, false)
  expect(quiet['--glass-rail']).toBe('rgb(220 220 225 / 0.93)')
  expect(loud['--glass-rail']).toBe('rgb(220 220 225 / 0.5)')
  expect(decorVariables({ palette: 'dawn', intensity: 1 }, true)['--glass-panel']).toBe('rgb(31 31 33 / 0.66)')
  expect(decorVariables({ palette: 'dawn', intensity: 1 }, false, true)['--glass-rail']).toBe('rgb(220 220 225)')
  expect(decorVariables({ palette: 'mono', intensity: 0.5 }, false)['--decor-accent']).toBe('rgb(0 0 0)')
})

test('sanitize clamps intensity and rejects unknown palettes', () => {
  expect(sanitizeDecor({ palette: 'forest', intensity: 3 })).toEqual({ palette: 'forest', intensity: 1 })
  expect(sanitizeDecor({ palette: 'neon', intensity: Number.NaN })).toEqual(DEFAULT_DECOR)
  expect(sanitizeDecor(null)).toEqual(DEFAULT_DECOR)
})
