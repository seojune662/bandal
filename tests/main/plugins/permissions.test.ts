import { describe, expect, test } from 'vitest'
import { isAllowed } from '../../../src/main/features/plugins/permissions'

describe('main plugin permission gate', () => {
  test('checks the permission mapped to a static API method', () => {
    expect(isAllowed(['notes.read'], 'notes.list', [])).toBe(true)
    expect(isAllowed(['notes.read'], 'notes.write', ['note-1', 'body'])).toBe(
      false
    )
    expect(isAllowed(['notes.write'], 'notes.write', ['note-1', 'body'])).toBe(
      true
    )
  })

  test('uses args[0] as the URL for net.fetch', () => {
    const granted = ['net:api.example.com'] as const

    expect(
      isAllowed(granted, 'net.fetch', ['https://api.example.com/data'])
    ).toBe(true)
    expect(
      isAllowed(granted, 'net.fetch', ['https://other.example.com/data'])
    ).toBe(false)
    expect(isAllowed(granted, 'net.fetch', [42])).toBe(false)
    expect(isAllowed(granted, 'net.fetch', [])).toBe(false)
  })
})
