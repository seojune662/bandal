import { describe, expect, test } from 'vitest'
import {
  createGuestRegistry,
  type GuestWebContents
} from '../../../src/main/features/browserAgent/guestRegistry'

function guest(over: Partial<GuestWebContents> = {}): GuestWebContents {
  return {
    id: 7,
    getType: () => 'webview',
    getURL: () => 'https://myetl.snu.ac.kr/',
    isDestroyed: () => false,
    session: {},
    ...over
  }
}

function registry(
  resolved: GuestWebContents | null,
  browsing = true
) {
  return createGuestRegistry({
    fromId: () => resolved,
    isBrowsingPartition: () => browsing
  })
}

describe('guestRegistry', () => {
  test('resolves a live browsing guest', () => {
    const api = registry(guest())
    api.register('t1', 7)
    expect(api.resolve('t1')?.id).toBe(7)
  })

  test('an unregistered tab resolves to nothing', () => {
    expect(registry(guest()).resolve('t1')).toBeNull()
  })

  test('refuses anything that is not a webview', () => {
    // The agent must never be able to reach the app's own renderer.
    const api = registry(guest({ getType: () => 'window' }))
    api.register('t1', 7)
    expect(api.resolve('t1')).toBeNull()
  })

  test('refuses a guest outside the hardened partition', () => {
    const api = registry(guest(), false)
    api.register('t1', 7)
    expect(api.resolve('t1')).toBeNull()
  })

  test('a destroyed guest is dropped, not returned', () => {
    // WebContents ids are reused; a stale mapping would hand back something
    // else entirely.
    const api = registry(guest({ isDestroyed: () => true }))
    api.register('t1', 7)
    expect(api.resolve('t1')).toBeNull()
    expect(api.resolve('t1')).toBeNull()
  })

  test('a throwing lookup is null, not a crash', () => {
    const api = createGuestRegistry({
      fromId: () => {
        throw new Error('gone')
      },
      isBrowsingPartition: () => true
    })
    api.register('t1', 7)
    expect(api.resolve('t1')).toBeNull()
  })

  test('ignores junk registrations', () => {
    const api = registry(guest())
    api.register('', 7)
    api.register('t1', Number.NaN)
    expect(api.resolve('')).toBeNull()
    expect(api.resolve('t1')).toBeNull()
  })

  test('forgetting a tab unmaps it', () => {
    const api = registry(guest())
    api.register('t1', 7)
    api.forget('t1')
    expect(api.resolve('t1')).toBeNull()
  })
})
