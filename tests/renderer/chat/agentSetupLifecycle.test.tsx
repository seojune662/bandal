// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { AgentSetupCard } from '../../../src/renderer/src/features/chat/AgentSetupCards'
import { refreshAgentConnection, resetAgentConnectionsForTests, useAgentConnectionStore } from '../../../src/renderer/src/features/chat/agentConnectionStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

vi.mock('../../../src/renderer/src/components/BandalMark', () => ({ BandalMark: () => null }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; resetAgentConnectionsForTests(); setIpcAdapter(null); vi.useRealTimers() })

test('new signed-out availability objects do not reacquire and recursively probe the rendered setup card', async () => {
  vi.useFakeTimers()
  let probes = 0
  const signedOut = { installed: true, loggedIn: false }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'agent:availability') {
      probes += 1
      // Bound a broken implementation's recursion so the regression can fail.
      if (probes > 4) return new Promise(() => undefined)
      return { ...signedOut }
    }
    return { command: 'install', supported: true }
  })
  setIpcAdapter({ invoke, on: () => () => undefined } as unknown as IpcAdapter)
  const refresh = vi.fn()
  function SharedAvailabilityCard() {
    const availability = useAgentConnectionStore(state => state.connections.codex.availability) ?? signedOut
    return <AgentSetupCard provider="codex" availability={availability} onProviderChange={() => undefined} onRefresh={refresh} />
  }
  const container = document.createElement('div'); root = createRoot(container)
  await act(async () => { root!.render(<SharedAvailabilityCard />); for (let i = 0; i < 12; i++) await Promise.resolve() })
  expect(probes).toBe(1)
  await act(async () => { await refreshAgentConnection('codex', true); for (let i = 0; i < 12; i++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(6_000) })
  expect(probes).toBe(2)
  expect(refresh).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Codex (GPT) 로그인이 필요해요')
})
