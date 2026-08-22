import { afterEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getSources: vi.fn(),
  screen: {
    getAllDisplays: vi.fn(() => [
      {
        id: 7,
        label: 'Built-in',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
        scaleFactor: 1
      }
    ]),
    getPrimaryDisplay: vi.fn(() => ({ id: 7 })),
    getDisplayNearestPoint: vi.fn(() => ({
      id: 7,
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      scaleFactor: 1
    })),
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 }))
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  clipboard: { readText: vi.fn(() => '') },
  desktopCapturer: { getSources: electronMocks.getSources },
  screen: electronMocks.screen,
  systemPreferences: { getMediaAccessStatus: vi.fn(() => 'granted') }
}))

import { createElectronDesktopDeps } from '../../../src/main/features/desktopAgent/electronSurface'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('electron desktop capture overlay concealment', () => {
  test('waits 60ms after concealment and restores protection after capture', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    electronMocks.getSources.mockImplementation(async () => {
      order.push('capture')
      return [
        {
          display_id: '7',
          thumbnail: {
            isEmpty: () => false,
            getSize: () => ({ width: 1200, height: 800 }),
            toJPEG: () => Buffer.from('jpeg')
          }
        }
      ]
    })
    const deps = createElectronDesktopDeps({
      concealOverlay: () => {
        order.push('conceal')
        return () => order.push('restore')
      }
    })

    const result = deps.captureDisplay('7', 1000)
    await Promise.resolve()
    expect(order).toEqual(['conceal'])

    await vi.advanceTimersByTimeAsync(59)
    expect(order).toEqual(['conceal'])
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toMatchObject({ width: 1200, height: 800 })
    expect(order).toEqual(['conceal', 'capture', 'restore'])
  })
})
