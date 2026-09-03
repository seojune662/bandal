import { describe, expect, test } from 'vitest'
import { shouldOpenExternally } from '../../../src/renderer/src/app/openHttpLink'

describe('shouldOpenExternally', () => {
  test('uses routing unless Shift and the platform modifier are both held', () => {
    expect(
      shouldOpenExternally('in-app', { shift: false, mod: false })
    ).toBe(false)
    expect(
      shouldOpenExternally('in-app', { shift: true, mod: false })
    ).toBe(false)
    expect(
      shouldOpenExternally('in-app', { shift: true, mod: true })
    ).toBe(true)
    expect(
      shouldOpenExternally('system', { shift: false, mod: false })
    ).toBe(true)
  })
})
