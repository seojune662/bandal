import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopSurface,
  type DesktopSurfaceDeps,
  type DisplayInfo,
  type RawCapture,
  type WindowInfo
} from '../../../src/main/features/desktopAgent/desktopSurface'
import {
  FALLBACK_LONG_EDGE,
  MAX_IMAGE_BYTES,
  MAX_LONG_EDGE
} from '../../../src/main/features/desktopAgent/image'

const displays: DisplayInfo[] = [
  {
    id: 'primary',
    label: 'Built-in',
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    scaleFactor: 2,
    primary: true
  },
  {
    id: 'cursor',
    label: 'External',
    bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    primary: false
  }
]

const windows: WindowInfo[] = [
  {
    id: 'window:42:0',
    title: '강의 계획서',
    appName: 'Safari',
    frontmost: true
  }
]

function capture(width = 1000, height = 600): RawCapture {
  return {
    width,
    height,
    toJPEG: vi.fn(() => Buffer.from('jpeg'))
  }
}

function fakeDeps(overrides: Partial<DesktopSurfaceDeps> = {}): DesktopSurfaceDeps {
  return {
    listDisplays: vi.fn(() => displays),
    cursorDisplayId: vi.fn(() => 'cursor'),
    captureDisplay: vi.fn(async () => capture()),
    captureWindow: vi.fn(async () => capture()),
    listWindows: vi.fn(async () => windows),
    frontmostApp: vi.fn(async () => ({
      appName: 'Safari',
      windowTitle: '강의 계획서',
      pid: 42
    })),
    readClipboardText: vi.fn(() => '복사한 텍스트'),
    screenAccess: vi.fn(() => 'granted'),
    ...overrides
  }
}

describe('desktopSurface screenshot', () => {
  it('returns the settings instruction without capturing when access is denied', async () => {
    const deps = fakeDeps({ screenAccess: vi.fn(() => 'denied') })
    const result = await createDesktopSurface(deps).screenshot({})

    expect(result).toEqual({
      kind: 'problem',
      problem:
        '시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 반달을 켠 뒤, 반달을 다시 실행해 주세요',
      access: 'denied'
    })
    expect(deps.captureDisplay).not.toHaveBeenCalled()
  })

  it('uses the display under the cursor when no target is specified', async () => {
    const deps = fakeDeps()
    const surface = createDesktopSurface(deps, {
      now: () => new Date('2026-08-21T01:02:03.000Z')
    })
    const result = await surface.screenshot({})

    expect(deps.captureDisplay).toHaveBeenCalledWith('cursor', MAX_LONG_EDGE)
    expect(result).toMatchObject({
      kind: 'ok',
      display: displays[1],
      window: null,
      mimeType: 'image/jpeg',
      width: 1000,
      height: 600,
      bytes: 4,
      capturedAt: '2026-08-21T01:02:03.000Z'
    })
  })

  it('attempts capture while access is not determined', async () => {
    const deps = fakeDeps({ screenAccess: vi.fn(() => 'not-determined') })

    const result = await createDesktopSurface(deps).screenshot({})

    expect(deps.captureDisplay).toHaveBeenCalledTimes(1)
    expect(result.kind).toBe('ok')
  })

  it('attaches metadata for a window target', async () => {
    const deps = fakeDeps()
    const result = await createDesktopSurface(deps).screenshot({
      window: 'window:42:0'
    })

    expect(deps.listWindows).toHaveBeenCalledTimes(1)
    expect(deps.captureWindow).toHaveBeenCalledWith(
      'window:42:0',
      MAX_LONG_EDGE
    )
    expect(result).toMatchObject({
      kind: 'ok',
      display: null,
      window: windows[0]
    })
  })

  it('recaptures once at the fallback edge when both qualities are oversized', async () => {
    const first: RawCapture = {
      width: 1568,
      height: 900,
      toJPEG: vi.fn(() => Buffer.alloc(MAX_IMAGE_BYTES + 1))
    }
    const second = capture(1280, 735)
    const captureDisplay = vi
      .fn<DesktopSurfaceDeps['captureDisplay']>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const deps = fakeDeps({ captureDisplay })

    const result = await createDesktopSurface(deps).screenshot({
      display: 'primary'
    })

    expect(captureDisplay.mock.calls).toEqual([
      ['primary', MAX_LONG_EDGE],
      ['primary', FALLBACK_LONG_EDGE]
    ])
    expect(result).toMatchObject({ kind: 'ok', width: 1280, height: 735 })
  })

  it('does not return an image that remains oversized after one recapture', async () => {
    const oversized = (): RawCapture => ({
      width: 1568,
      height: 900,
      toJPEG: vi.fn(() => Buffer.alloc(MAX_IMAGE_BYTES + 1))
    })
    const captureDisplay = vi
      .fn<DesktopSurfaceDeps['captureDisplay']>()
      .mockResolvedValueOnce(oversized())
      .mockResolvedValueOnce(oversized())
    const deps = fakeDeps({ captureDisplay })

    const result = await createDesktopSurface(deps).screenshot({})

    expect(result.kind).toBe('problem')
    expect(captureDisplay).toHaveBeenCalledTimes(2)
  })
})
