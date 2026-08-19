/**
 * Binds the agent's page tools to real guests.
 *
 * Everything Electron-shaped lives here so `browserTools` and `pageDriver`
 * stay testable without a browser. The interesting parts are the two places
 * this has to wait on something outside main:
 *
 *  - opening a tab, which the RENDERER owns (guests live in its fixed layer),
 *    so main asks and then waits for the tab to register itself
 *  - a handoff, which waits on the student
 *
 * Both are bounded. An agent that hangs forever is worse than one that gives
 * up and says what it could not do.
 */

import type { GuestWebContents } from './guestRegistry'
import { createPageDriver, type DriverFrame } from './pageDriver'
import type { PageSurface } from './browserTools'
import type { GenerationTracker } from './refs'
import { RunStopped } from './run'

/** A tab that never registers is a tab the agent cannot use. */
const OPEN_TIMEOUT_MS = 10_000
/** Long enough for an OTP, short enough that a forgotten run ends. */
const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000

export interface PageSurfaceDeps {
  resolveGuest: (tabId: string) => GuestWebContents | null
  /** Frames of a guest, main frame first. */
  framesOf: (guest: GuestWebContents) => DriverFrame[]
  /** Asks the renderer to open a browser tab at this URL. */
  requestOpenTab: (url: string) => void
  /** Resolves with the tabId once the renderer registers a guest for `url`. */
  awaitTabFor: (url: string, timeoutMs: number) => Promise<string | null>
  generations: GenerationTracker
  run: {
    assertLive: () => void
    step: (action: string, url?: string) => void
    wait: (message: string) => void
    /** Resolves when the student presses 계속, or rejects if they stop. */
    awaitResume: (timeoutMs: number) => Promise<'resumed' | 'stopped'>
  }
}

export function createPageSurface(deps: PageSurfaceDeps): PageSurface {
  function driverFor(tabId: string): ReturnType<typeof createPageDriver> | null {
    const guest = deps.resolveGuest(tabId)
    if (guest === null) return null
    return createPageDriver({
      frames: () => deps.framesOf(guest),
      currentUrl: () => guest.getURL()
    })
  }

  return {
    async openTab(url) {
      deps.requestOpenTab(url)
      const tabId = await deps.awaitTabFor(url, OPEN_TIMEOUT_MS)
      if (tabId === null) {
        throw new Error('탭을 여는 데 실패했어요.')
      }
      return { tabId, url }
    },

    generation(tabId) {
      return deps.generations.current(tabId)
    },

    currentUrl(tabId) {
      const guest = deps.resolveGuest(tabId)
      if (guest === null) return null
      try {
        return guest.getURL()
      } catch {
        return null
      }
    },

    async snapshot(tabId, maxChars) {
      const driver = driverFor(tabId)
      if (driver === null) return null
      const result = await driver.snapshot(
        deps.generations.current(tabId),
        maxChars
      )
      return { url: result.url, outline: result.outline }
    },

    async read(tabId, maxChars) {
      const driver = driverFor(tabId)
      if (driver === null) return null
      return driver.read(maxChars)
    },

    async factsFor(tabId, frameIndex, elementIndex) {
      const driver = driverFor(tabId)
      if (driver === null) return null
      return driver.factsFor(frameIndex, elementIndex)
    },

    async act(tabId, frameIndex, elementIndex, action) {
      const driver = driverFor(tabId)
      if (driver === null) return false
      const result = await driver.act(frameIndex, elementIndex, action)
      return result.ok
    },

    async handoff(tabId, message) {
      deps.run.wait(message)
      try {
        return await deps.run.awaitResume(HANDOFF_TIMEOUT_MS)
      } catch (error) {
        if (error instanceof RunStopped) return 'stopped'
        return 'stopped'
      }
    },

    assertLive() {
      deps.run.assertLive()
    },

    step(action, url) {
      deps.run.step(action, url)
    }
  }
}
