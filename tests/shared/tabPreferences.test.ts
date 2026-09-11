import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TAB_PREFERENCES,
  sanitizeTabPreferences
} from '../../src/shared/tabPreferences'
import { isTabDescriptor } from '../../src/shared/tabs'
import {
  tabPanelId,
  tabTitle
} from '../../src/renderer/src/features/workspace/tabIdentity'

describe('tab preferences and recording identity', () => {
  it('migrates older settings to stable defaults', () => {
    expect(sanitizeTabPreferences(undefined)).toEqual(DEFAULT_TAB_PREFERENCES)
    expect(sanitizeTabPreferences([])).toEqual(DEFAULT_TAB_PREFERENCES)
  })
  it('validates persisted values without changing model defaults silently', () => {
    expect(
      sanitizeTabPreferences({
        recordingModel: 'invalid',
        recordingPlaybackRate: Infinity,
        recordingDeviceId: '',
        whiteboardBackground: 'bad'
      })
    ).toEqual(DEFAULT_TAB_PREFERENCES)
    expect(
      sanitizeTabPreferences({
        recordingModel: 'sensevoice',
        recordingPlaybackRate: 1.5,
        recordingSidebarOpen: false,
        boardHideDone: true
      })
    ).toMatchObject({
      recordingModel: 'sensevoice',
      recordingPlaybackRate: 1.5,
      recordingSidebarOpen: false,
      boardHideDone: true
    })
  })
  it('keeps legacy library tabs and individual recordings distinct', () => {
    const legacy = {
      kind: 'recording' as const,
      payload: { courseId: 'course' }
    }
    const first = {
      kind: 'recording' as const,
      payload: { courseId: 'course', sessionId: 'one', title: '첫 강의' }
    }
    const second = {
      kind: 'recording' as const,
      payload: { courseId: 'course', sessionId: 'two' }
    }
    expect([legacy, first, second].every(isTabDescriptor)).toBe(true)
    expect(new Set([legacy, first, second].map(tabPanelId)).size).toBe(3)
    expect(tabPanelId(legacy)).toBe('recording:course')
    expect(tabTitle(first)).toBe('첫 강의')
    expect(
      isTabDescriptor({
        kind: 'recording',
        payload: { courseId: 'course', sessionId: 12 }
      })
    ).toBe(false)
  })
})
