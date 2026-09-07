import { describe, expect, test } from 'vitest'
import {
  isWebPipIsolationResult,
  webPipIsolationSource
} from '../../../src/main/windows/webPipIsolation'

describe('web PiP isolation', () => {
  test('targets the reported video and reduces the document to its player', () => {
    const source = webPipIsolationSource(
      {
        kind: 'web',
        url: 'https://www.youtube.com/watch?v=lecture',
        title: 'Lecture',
        videoHint: { index: 2, aspect: 16 / 9 }
      },
      42,
      1.5,
      false
    )

    expect(source).toContain('const preferredIndex = 2')
    expect(source).toContain("video.closest('#movie_player')")
    expect(source).toContain("body *{visibility:hidden!important}")
    expect(source).toContain("video.setAttribute('data-bandal-pip-video'")
    expect(source).toContain('video.currentTime = Math.max(0, positionSec)')
  })

  test('accepts only successful, finite isolation reports', () => {
    expect(isWebPipIsolationResult({ ready: true, aspect: 4 / 3 })).toBe(true)
    expect(isWebPipIsolationResult({ ready: false })).toBe(true)
    expect(isWebPipIsolationResult(true)).toBe(false)
    expect(isWebPipIsolationResult({ ready: true, aspect: 0 })).toBe(false)
  })
})
