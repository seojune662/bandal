import { describe, expect, test } from 'vitest'
import {
  toggleLeadDay
} from '../../../../src/renderer/src/features/settings/notifications/NotificationsPanel'

describe('toggleLeadDay', () => {
  test('adds and removes lead days while keeping the UI order', () => {
    expect(toggleLeadDay([3, 1], 7)).toEqual([7, 3, 1])
    expect(toggleLeadDay([7, 3, 1], 3)).toEqual([7, 1])
  })
})
