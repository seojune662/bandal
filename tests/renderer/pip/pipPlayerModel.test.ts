import { describe, expect, test } from 'vitest'
import {
  applyPipSeek,
  createPipReportSchedule,
  INITIAL_PIP_PLAYER_UI_STATE,
  PIP_REPORT_INTERVAL_MS,
  pipPlayerUiReducer,
  planPipProgressReport
} from '../../../src/renderer/src/features/pip/pipPlayerModel'

describe('PiP progress reporting schedule', () => {
  test('reports every three seconds without bursting on early timer ticks', () => {
    const first = planPipProgressReport(
      createPipReportSchedule(1_000),
      3_999,
      'interval'
    )
    const due = planPipProgressReport(first.schedule, 4_000, 'interval')
    const early = planPipProgressReport(due.schedule, 6_999, 'interval')

    expect(first.shouldReport).toBe(false)
    expect(due.shouldReport).toBe(true)
    expect(early.shouldReport).toBe(false)
  })

  test.each(['metadata', 'playback', 'seek', 'rate'] as const)(
    'reports %s changes immediately',
    (trigger) => {
      const previous = { nextIntervalAtMs: 8_000 }
      const plan = planPipProgressReport(previous, 5_001, trigger)

      expect(plan.shouldReport).toBe(true)
      expect(plan.schedule.nextIntervalAtMs).toBe(8_000)
    }
  )
})

describe('PiP seek application', () => {
  test('clamps the requested position and playback rate to the video contract', () => {
    expect(
      applyPipSeek(
        { positionSec: 180, playbackRate: 3, play: true },
        120
      )
    ).toEqual({ positionSec: 120, playbackRate: 2, play: true })

    expect(
      applyPipSeek(
        { positionSec: Number.NaN, playbackRate: Number.NaN, play: false },
        null
      )
    ).toEqual({ positionSec: 0, playbackRate: 1, play: false })
  })

  test('updates player UI through its pure reducer', () => {
    const metadata = pipPlayerUiReducer(INITIAL_PIP_PLAYER_UI_STATE, {
      type: 'metadata',
      durationSec: 90
    })
    const seeked = pipPlayerUiReducer(metadata, {
      type: 'time',
      currentTimeSec: 120
    })
    const playing = pipPlayerUiReducer(seeked, {
      type: 'playback',
      paused: false
    })

    expect(playing.durationSec).toBe(90)
    expect(playing.currentTimeSec).toBe(90)
    expect(playing.paused).toBe(false)
  })
})
