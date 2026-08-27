import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  ProgressRing,
  clampProgress
} from '../../../src/renderer/src/features/help/ProgressRing'

describe('ProgressRing', () => {
  test('clamps the displayed percentage and exposes an accessible label', () => {
    expect(clampProgress(-20)).toBe(0)
    expect(clampProgress(130)).toBe(100)
    const html = renderToStaticMarkup(
      <ProgressRing progress={63.6} label="마일스톤 진행률" />
    )

    expect(html).toContain('aria-label="마일스톤 진행률 64%"')
    expect(html).toContain('stroke-dashoffset="36"')
    expect(html).toContain('>64%</text>')
  })
})
