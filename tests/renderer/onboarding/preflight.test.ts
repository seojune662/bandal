import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentAvailability } from '../../../src/shared/types/agent-events'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  INITIAL_PREFLIGHT_STATE,
  issuesOf,
  reducePreflight,
  resetPreflightForTests,
  useAgentPreflight,
  visibleIssues,
  type PreflightState
} from '../../../src/renderer/src/features/onboarding/useAgentPreflight'

const invokeMock = vi.mocked(invoke)

const READY: AgentAvailability = {
  installed: true,
  version: '2.1.222',
  loggedIn: true
}
const NOT_INSTALLED: AgentAvailability = { installed: false, loggedIn: false }
const NOT_LOGGED_IN: AgentAvailability = {
  installed: true,
  version: '2.1.222',
  loggedIn: false
}

describe('issuesOf', () => {
  test('no probe result → no issues', () => {
    expect(issuesOf(null)).toEqual([])
  })

  test('missing install outranks (and implies) missing login', () => {
    expect(issuesOf(NOT_INSTALLED)).toEqual(['not-installed'])
  })

  test('installed but logged out → login issue only', () => {
    expect(issuesOf(NOT_LOGGED_IN)).toEqual(['not-logged-in'])
  })

  test('fully ready → clean', () => {
    expect(issuesOf(READY)).toEqual([])
  })
})

describe('reducePreflight', () => {
  test('probe-start marks checking but keeps the last result visible', () => {
    const prior: PreflightState = {
      status: 'ready',
      availability: NOT_LOGGED_IN,
      dismissed: []
    }
    const next = reducePreflight(prior, { type: 'probe-start' })
    expect(next.status).toBe('checking')
    expect(next.availability).toEqual(NOT_LOGGED_IN)
  })

  test('probe-success stores the availability snapshot', () => {
    const next = reducePreflight(INITIAL_PREFLIGHT_STATE, {
      type: 'probe-success',
      availability: NOT_INSTALLED
    })
    expect(next).toEqual({
      status: 'ready',
      availability: NOT_INSTALLED,
      dismissed: []
    })
  })

  test('probe-failure flags error without clobbering old data', () => {
    const prior: PreflightState = {
      status: 'checking',
      availability: READY,
      dismissed: []
    }
    const next = reducePreflight(prior, { type: 'probe-failure' })
    expect(next.status).toBe('error')
    expect(next.availability).toEqual(READY)
  })

  test('dismiss records the issue once', () => {
    const once = reducePreflight(INITIAL_PREFLIGHT_STATE, {
      type: 'dismiss',
      issue: 'not-installed'
    })
    const twice = reducePreflight(once, {
      type: 'dismiss',
      issue: 'not-installed'
    })
    expect(twice.dismissed).toEqual(['not-installed'])
  })

  test('a dismissal expires once its issue is resolved', () => {
    const dismissed = reducePreflight(
      {
        status: 'ready',
        availability: NOT_LOGGED_IN,
        dismissed: []
      },
      { type: 'dismiss', issue: 'not-logged-in' }
    )
    // User logs in → issue gone → dismissal cleared…
    const healthy = reducePreflight(dismissed, {
      type: 'probe-success',
      availability: READY
    })
    expect(healthy.dismissed).toEqual([])
    // …so a later regression surfaces a fresh banner.
    const regressed = reducePreflight(healthy, {
      type: 'probe-success',
      availability: NOT_LOGGED_IN
    })
    expect(visibleIssues(regressed)).toEqual(['not-logged-in'])
  })

  test('a dismissal survives while its issue persists', () => {
    const dismissed = reducePreflight(
      { status: 'ready', availability: NOT_INSTALLED, dismissed: [] },
      { type: 'dismiss', issue: 'not-installed' }
    )
    const stillBroken = reducePreflight(dismissed, {
      type: 'probe-success',
      availability: NOT_INSTALLED
    })
    expect(visibleIssues(stillBroken)).toEqual([])
  })
})

describe('visibleIssues', () => {
  test('nothing shows before the first successful probe', () => {
    expect(visibleIssues(INITIAL_PREFLIGHT_STATE)).toEqual([])
    expect(
      visibleIssues({ status: 'checking', availability: null, dismissed: [] })
    ).toEqual([])
    expect(
      visibleIssues({ status: 'error', availability: null, dismissed: [] })
    ).toEqual([])
  })

  test('shows undismissed issues after a probe', () => {
    expect(
      visibleIssues({
        status: 'ready',
        availability: NOT_INSTALLED,
        dismissed: []
      })
    ).toEqual(['not-installed'])
  })
})

describe('useAgentPreflight store', () => {
  beforeEach(() => {
    resetPreflightForTests()
    invokeMock.mockReset()
  })

  afterEach(() => {
    resetPreflightForTests()
  })

  test('probe runs the live agent:availability check and lands in ready', async () => {
    invokeMock.mockResolvedValueOnce(NOT_LOGGED_IN)
    await useAgentPreflight.getState().probe()
    expect(invokeMock).toHaveBeenCalledWith('agent:availability', {
      provider: 'claude-code'
    })
    const state = useAgentPreflight.getState()
    expect(state.status).toBe('ready')
    expect(state.availability).toEqual(NOT_LOGGED_IN)
  })

  test('concurrent probes collapse into one invoke', async () => {
    invokeMock.mockResolvedValue(READY)
    const first = useAgentPreflight.getState().probe()
    const second = useAgentPreflight.getState().probe()
    await Promise.all([first, second])
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  test('probe failure never throws — it flags the error state', async () => {
    invokeMock.mockRejectedValueOnce(new Error('ipc down'))
    await useAgentPreflight.getState().probe()
    expect(useAgentPreflight.getState().status).toBe('error')
  })
})
