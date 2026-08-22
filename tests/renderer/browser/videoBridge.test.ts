import { describe, expect, test } from 'vitest'
import {
  parseVideoReport,
  VIDEO_REPORTER_SOURCE,
  VIDEO_REPORT_PREFIX
} from '../../../src/renderer/src/features/browser/videoBridge'

describe('video reporter', () => {
  test('parses a finite top-frame video snapshot', () => {
    expect(
      parseVideoReport(
        VIDEO_REPORT_PREFIX +
          JSON.stringify({
            hasPlayingVideo: true,
            currentTime: 83.25,
            playbackRate: 1.5,
            paused: false,
            pageUrl: 'https://lms.example.edu/lecture/1',
            title: '1주차 강의'
          })
      )
    ).toEqual({
      hasPlayingVideo: true,
      currentTime: 83.25,
      playbackRate: 1.5,
      paused: false,
      pageUrl: 'https://lms.example.edu/lecture/1',
      title: '1주차 강의'
    })
  })

  test.each([
    'unrelated',
    VIDEO_REPORT_PREFIX + '{',
    VIDEO_REPORT_PREFIX +
      JSON.stringify({
        hasPlayingVideo: true,
        currentTime: '83',
        playbackRate: 1,
        paused: false,
        pageUrl: 'https://lms.example.edu/',
        title: '강의'
      }),
    VIDEO_REPORT_PREFIX +
      JSON.stringify({
        hasPlayingVideo: true,
        currentTime: 83,
        playbackRate: 0,
        paused: false,
        pageUrl: 'javascript:alert(1)',
        title: '강의'
      })
  ])('rejects malformed or unsafe reports', (message) => {
    expect(parseVideoReport(message)).toBeNull()
  })

  test('installs once and debounces media changes for one second', () => {
    expect(VIDEO_REPORTER_SOURCE).toContain(
      '__bandalVideoReporterInstalledV1__'
    )
    expect(VIDEO_REPORTER_SOURCE).toContain('window.setTimeout(report, 1000)')
    expect(VIDEO_REPORTER_SOURCE).toContain(VIDEO_REPORT_PREFIX)
  })
})
