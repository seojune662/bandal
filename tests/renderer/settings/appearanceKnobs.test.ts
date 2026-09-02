// @vitest-environment jsdom

/**
 * The three appearance knobs (글자 크기 · 필기 글꼴 · 밀도) are pure CSS
 * switches on <html>; this pins the attribute/property names the stylesheets
 * key on, so a rename in either half fails here instead of silently no-op'ing.
 */

import { describe, expect, test } from 'vitest'
import {
  applyAppearanceKnobs,
  isSameAppearance,
  pickAppearance
} from '../../../src/shared/appearance'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

describe('applyAppearanceKnobs', () => {
  test('writes density, editor font and the font-scale property on the root', () => {
    const root = document.createElement('html')

    applyAppearanceKnobs(root, {
      fontScale: 1.2,
      editorFont: 'serif',
      density: 'compact'
    })

    expect(root.dataset['density']).toBe('compact')
    expect(root.dataset['editorFont']).toBe('serif')
    expect(root.style.getPropertyValue('--font-scale')).toBe('1.2')
  })

  test('re-applying the defaults clears a previous choice', () => {
    const root = document.createElement('html')
    applyAppearanceKnobs(root, {
      fontScale: 0.9,
      editorFont: 'mono',
      density: 'compact'
    })

    applyAppearanceKnobs(root, DEFAULT_SETTINGS)

    expect(root.dataset['density']).toBe('comfortable')
    expect(root.dataset['editorFont']).toBe('sans')
    expect(root.style.getPropertyValue('--font-scale')).toBe('1')
  })
})

describe('appearance helpers', () => {
  test('pickAppearance keeps only the five appearance keys', () => {
    expect(Object.keys(pickAppearance(DEFAULT_SETTINGS)).sort()).toEqual(
      ['density', 'editorFont', 'fontScale', 'palette', 'theme']
    )
  })

  test('isSameAppearance compares every axis', () => {
    const base = pickAppearance(DEFAULT_SETTINGS)
    expect(isSameAppearance(base, { ...base })).toBe(true)
    expect(isSameAppearance(base, { ...base, fontScale: 1.1 })).toBe(false)
    expect(isSameAppearance(base, { ...base, density: 'compact' })).toBe(false)
    expect(isSameAppearance(base, { ...base, editorFont: 'mono' })).toBe(false)
  })
})
