import { describe, expect, test } from 'vitest'
import { permissionTone } from '../../../../src/renderer/src/features/settings/permissions/PermissionsPanel'

describe('permissionTone', () => {
  test.each([
    ['granted', 'ok'],
    ['denied', 'danger'],
    ['not-determined', 'neutral'],
    ['unknown', 'neutral'],
    ['not-applicable', 'muted']
  ] as const)('maps %s to %s', (state, tone) => {
    expect(permissionTone(state)).toBe(tone)
  })
})
