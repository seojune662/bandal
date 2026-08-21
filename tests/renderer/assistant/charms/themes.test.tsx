import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ORB_CHARM_IDS } from '../../../../src/shared/orbCharm'
import {
  CHARM_THEMES,
  getCharmTheme
} from '../../../../src/renderer/src/features/assistant/charms/registry'

const ids = Object.keys(CHARM_THEMES) as Array<keyof typeof CHARM_THEMES>

describe('charm theme registry', () => {
  test('covers every id except none', () => {
    expect(new Set(ids)).toEqual(new Set(ORB_CHARM_IDS.filter((id) => id !== 'none')))
    expect(getCharmTheme('none')).toBeNull()
  })

  test.each(ids)('%s renders token-only SVG with data-part hooks', (id) => {
    const theme = CHARM_THEMES[id]
    const markup = renderToStaticMarkup(<theme.Character />)
    expect(markup).toContain('data-part="')
    expect(markup).not.toMatch(/NaN/)
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(renderToStaticMarkup(<theme.Preview />)).not.toBe('')
    expect(theme.id).toBe(id)
    expect(theme.rope.segments).toBeGreaterThan(0)
    expect(theme.anchor === 'above').toBe(theme.rope.gravity < 0)
  })
})
