import { expect, test, vi } from 'vitest'
import {
  activateRecordingView,
  registerRecordingView
} from '../../../src/renderer/src/features/recordings/recordingNavigation'

test('reuses the open capture view and unregisters it on tab close', () => {
  const activate = vi.fn()
  const unregister = registerRecordingView('library', 'capture', activate)
  expect(activateRecordingView('other')).toBe(false)
  expect(activateRecordingView('capture')).toBe(true)
  expect(activate).toHaveBeenCalledTimes(1)
  unregister()
  expect(activateRecordingView('capture')).toBe(false)
})

test('a stale effect cleanup cannot remove a newer view registration', () => {
  const first = registerRecordingView('library', 'old', vi.fn())
  const activate = vi.fn()
  const second = registerRecordingView('library', 'new', activate)
  first()
  expect(activateRecordingView('new')).toBe(true)
  expect(activate).toHaveBeenCalledOnce()
  second()
})
