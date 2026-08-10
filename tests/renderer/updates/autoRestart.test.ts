/**
 * Updating used to take two clicks: 업데이트, then 재시작 on a second toast the
 * student had to notice. It is one gesture now — but "one gesture" must not
 * become "restarts on its own".
 */

import { describe, expect, test } from 'vitest'
import { mayRestartUnprompted } from '../../../src/renderer/src/features/updates/useUpdateNotifications'

describe('applying an update without a second click', () => {
  test('restarts for the version the student just pressed 업데이트 on', () => {
    expect(mayRestartUnprompted('0.7.0', '0.7.0')).toBe(true)
  })

  test('does not restart for a build downloaded in an earlier session', () => {
    // `ready` fires again on the next launch. Acting on it would close the
    // student's tabs at a moment they did not choose.
    expect(mayRestartUnprompted('0.7.0', null)).toBe(false)
  })

  test('does not restart when a different version became ready', () => {
    expect(mayRestartUnprompted('0.8.0', '0.7.0')).toBe(false)
  })
})
