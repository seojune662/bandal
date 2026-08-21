import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ORB_CHARM,
  ORB_CHARM_IDS,
  isOrbCharmId
} from '../../src/shared/orbCharm'

describe('isOrbCharmId', () => {
  test.each(ORB_CHARM_IDS)('accepts registered id %s', (id) => {
    expect(isOrbCharmId(id)).toBe(true)
  })

  test.each([['spiderman'], [''], [3], [null], [undefined], [{}]])(
    'rejects %p',
    (value) => {
      expect(isOrbCharmId(value)).toBe(false)
    }
  )

  test('default is none so existing users see no change', () => {
    expect(DEFAULT_ORB_CHARM).toBe('none')
    expect(ORB_CHARM_IDS[0]).toBe('none')
  })
})
