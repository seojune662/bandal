import { describe, expect, test, vi } from 'vitest'
import { RawToolResult } from '../../../src/main/features/agentTools/toolHandlers/context'
import type { AgentConfirmScope } from '../../../src/shared/types/agentTools'
import type { DesktopAuditEntry } from '../../../src/main/features/desktopAgent/audit'
import type { DesktopSurface } from '../../../src/main/features/desktopAgent/desktopSurface'
import {
  createDesktopTools,
  type DesktopToolsDeps
} from '../../../src/main/features/desktopAgent/desktopTools'
import type {
  DesktopCapability,
  DesktopGrantsRepo
} from '../../../src/main/features/desktopAgent/grants'

let harnessId = 0

function createHarness(options: {
  scope?: AgentConfirmScope | false
  heldScreenGrant?: boolean
  clipboard?: string
} = {}) {
  harnessId += 1
  let turnId: string | number = 'turn-1'
  let screenGrant = options.heldScreenGrant === true
  let lastUsedAt: string | null = null
  const auditEntries: Array<
    Omit<DesktopAuditEntry, 'id' | 'createdAt'>
  > = []
  const jpeg = Buffer.from('private-image-pixels')
  const screenshot = vi.fn<DesktopSurface['screenshot']>(async () => ({
    kind: 'ok',
    jpeg,
    mimeType: 'image/jpeg',
    width: 1200,
    height: 800,
    display: {
      id: 'display-1',
      label: 'Built-in',
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      scaleFactor: 2,
      primary: true
    },
    window: null,
    bytes: jpeg.byteLength,
    capturedAt: '2026-08-21T00:00:00.000Z'
  }))
  const surface: DesktopSurface = {
    screenshot,
    windows: vi.fn(async () => ({
      displays: [
        {
          id: 'display-1',
          label: 'Built-in',
          bounds: { x: 0, y: 0, width: 1200, height: 800 },
          scaleFactor: 2,
          primary: true
        }
      ],
      windows: []
    })),
    frontmost: vi.fn(async () => ({
      appName: 'Finder',
      windowTitle: 'Documents'
    })),
    clipboardText: vi.fn(() => options.clipboard ?? 'copied text'),
    access: vi.fn(() => 'granted')
  }
  const grant = vi.fn(
    (_courseId: string, capability: DesktopCapability): void => {
      if (capability === 'screen') screenGrant = true
    }
  )
  const grants: DesktopGrantsRepo = {
    find: vi.fn((_courseId, capability) =>
      capability === 'screen' && screenGrant
        ? { id: 'grant-1', expiresAt: '2026-09-20T00:00:00.000Z' }
        : null
    ),
    grant,
    revoke: vi.fn(() => 0),
    touch: vi.fn(() => {
      lastUsedAt = '2026-08-21T00:00:00.000Z'
    }),
    list: vi.fn(() =>
      screenGrant
        ? [
            {
              id: 'grant-1',
              capability: 'screen' as const,
              expiresAt: '2026-09-20T00:00:00.000Z',
              lastUsedAt
            }
          ]
        : []
    )
  }
  const confirm = vi.fn(async () => options.scope ?? 'once')
  const run = { set: vi.fn(), clear: vi.fn() }
  const deps: DesktopToolsDeps = {
    courseId: 'course-a',
    conversationId: `conversation-${harnessId}`,
    getTurnId: () => turnId,
    surface,
    grants,
    audit: {
      record: vi.fn((entry) => auditEntries.push(entry)),
      recent: vi.fn(() => [])
    },
    confirm,
    run
  }

  return {
    tools: createDesktopTools(deps),
    confirm,
    grant,
    grants,
    surface,
    screenshot,
    jpeg,
    auditEntries,
    run,
    nextTurn: () => {
      turnId = typeof turnId === 'number' ? turnId + 1 : `${turnId}-next`
    }
  }
}

describe('desktop tools permission gate', () => {
  test('once asks again and returns an image RawToolResult without auditing base64', async () => {
    const harness = createHarness({ scope: 'once' })

    const first = await harness.tools.desktop_screenshot({})
    const second = await harness.tools.desktop_screenshot({ display: 'display-1' })

    expect(harness.confirm).toHaveBeenCalledTimes(2)
    expect(harness.grant).not.toHaveBeenCalled()
    expect(first).toBeInstanceOf(RawToolResult)
    expect(second).toBeInstanceOf(RawToolResult)
    const raw = first as RawToolResult
    expect(raw.result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image', mimeType: 'image/jpeg' })
      ])
    )
    const encoded = harness.jpeg.toString('base64')
    expect(JSON.stringify(harness.auditEntries)).not.toContain(encoded)
  })

  test('conversation remembers screen permission only in that conversation', async () => {
    const harness = createHarness({ scope: 'conversation' })

    await harness.tools.desktop_windows({})
    await harness.tools.desktop_frontmost({})

    expect(harness.confirm).toHaveBeenCalledTimes(1)
    expect(harness.grant).not.toHaveBeenCalled()
  })

  test('always persists a 30-day screen grant and touches it on reuse', async () => {
    const harness = createHarness({ scope: 'always' })

    await harness.tools.desktop_screenshot({})
    await harness.tools.desktop_screenshot({})

    expect(harness.confirm).toHaveBeenCalledTimes(1)
    expect(harness.grant).toHaveBeenCalledWith('course-a', 'screen')
    expect(harness.grants.touch).toHaveBeenCalledWith('grant-1')
  })

  test('deny does not touch the surface and records the refusal', async () => {
    const harness = createHarness({ scope: false })

    await expect(harness.tools.desktop_screenshot({})).resolves.toEqual({
      error: '학생이 화면 보기를 허락하지 않았어요'
    })
    expect(harness.screenshot).not.toHaveBeenCalled()
    expect(harness.auditEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'denied' })])
    )
  })
})

describe('desktop tools limits and clipboard privacy', () => {
  test('resets the six-screenshot limit when the turn id changes', async () => {
    const harness = createHarness({ heldScreenGrant: true })

    for (let index = 0; index < 6; index += 1) {
      expect(await harness.tools.desktop_screenshot({})).toBeInstanceOf(
        RawToolResult
      )
    }
    await expect(harness.tools.desktop_screenshot({})).resolves.toEqual({
      error: '이번 턴에 화면은 6장까지만 볼 수 있어요'
    })

    harness.nextTurn()
    expect(await harness.tools.desktop_screenshot({})).toBeInstanceOf(
      RawToolResult
    )
  })

  test('clipboard always asks once, is redacted and never creates a grant', async () => {
    const harness = createHarness({
      scope: 'once',
      clipboard: `학번 202612345 ${'가'.repeat(5_000)}`
    })

    const first = (await harness.tools.desktop_clipboard_read({})) as {
      text: string
    }
    await harness.tools.desktop_clipboard_read({})

    expect(harness.confirm).toHaveBeenCalledTimes(2)
    expect(harness.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['once'] })
    )
    expect(harness.grant).not.toHaveBeenCalled()
    expect(first.text).not.toContain('202612345')
    expect(first.text.length).toBeLessThanOrEqual(4_000)
    expect(JSON.stringify(harness.auditEntries)).not.toContain('202612345')
  })

  test('sets capture activity and returns to idle even when capture fails', async () => {
    const harness = createHarness({ heldScreenGrant: true })
    harness.screenshot.mockRejectedValueOnce(new Error('capture failed'))

    await harness.tools.desktop_screenshot({})

    expect(harness.run.set).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^conversation-/),
      'capturing',
      '화면을 보는 중'
    )
    expect(harness.run.set).toHaveBeenLastCalledWith(
      expect.stringMatching(/^conversation-/),
      'idle'
    )
  })
})
