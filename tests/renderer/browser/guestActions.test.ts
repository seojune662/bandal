/**
 * The webContentsId -> tabId registry that routes a chord back to the guest
 * that swallowed it.
 *
 * Regression: `shortcut:passthrough` used to carry only an action, so the
 * renderer closed the ACTIVE dockview panel. Guests live in a fixed layer
 * outside the panel DOM and focusing one does not activate its panel, so in a
 * split ⌘W closed the wrong tab.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
  registerGuestElement,
  registerGuestWebContents,
  tabIdForWebContents,
  unregisterGuestElement
} from '../../../src/renderer/src/features/browser/guestActions'
import type { WebviewTag } from '../../../src/renderer/src/features/browser/webviewTypes'

function fakeGuest(webContentsId: number | Error): WebviewTag {
  return {
    getWebContentsId: () => {
      if (webContentsId instanceof Error) throw webContentsId
      return webContentsId
    }
  } as unknown as WebviewTag
}

describe('guest webContents registry', () => {
  beforeEach(() => {
    // Registrations are module state; drop anything a prior test left behind.
    for (const id of [11, 22, 33]) {
      const mapped = tabIdForWebContents(id)
      if (mapped !== null) unregisterGuestElement(mapped, fakeGuest(id))
    }
  })

  test('maps a registered guest back to its tab', () => {
    const guest = fakeGuest(11)
    registerGuestElement('tab-a', guest)
    registerGuestWebContents('tab-a', guest)
    expect(tabIdForWebContents(11)).toBe('tab-a')
  })

  test('keeps two live guests apart', () => {
    const a = fakeGuest(11)
    const b = fakeGuest(22)
    registerGuestElement('tab-a', a)
    registerGuestWebContents('tab-a', a)
    registerGuestElement('tab-b', b)
    registerGuestWebContents('tab-b', b)

    // The split-view case: the chord came from B, so it must resolve to B.
    expect(tabIdForWebContents(22)).toBe('tab-b')
    expect(tabIdForWebContents(11)).toBe('tab-a')
  })

  test('returns null for an unknown WebContents', () => {
    expect(tabIdForWebContents(999)).toBeNull()
  })

  test('forgets the mapping when the guest goes away', () => {
    const guest = fakeGuest(33)
    registerGuestElement('tab-c', guest)
    registerGuestWebContents('tab-c', guest)
    unregisterGuestElement('tab-c', guest)
    expect(tabIdForWebContents(33)).toBeNull()
  })

  test('survives a guest that is not attached yet', () => {
    // getWebContentsId() throws before attach; the next dom-ready retries.
    const detached = fakeGuest(new Error('not attached'))
    expect(() => registerGuestWebContents('tab-d', detached)).not.toThrow()
  })
})
