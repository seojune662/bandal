/**
 * The glass box's store.
 *
 * The strip itself is driven by a push from main, so its live behaviour needs
 * a real agent run to see. What is testable — and what actually matters — is
 * that a finished run leaves NOTHING behind: a stale strip saying "reading…"
 * over an idle page is worse than no strip at all.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const handlers = new Map<string, (payload: unknown) => void>()

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(async () => ({ ok: true })),
  onPush: vi.fn((channel: string, handler: (payload: unknown) => void) => {
    handlers.set(channel, handler)
    return () => handlers.delete(channel)
  })
}))

import { useAgentRuns } from '../../../src/renderer/src/features/browser/AgentRunBanner'

function push(state: Record<string, unknown>): void {
  handlers.get('browserAgent:run-state')?.(state)
}

const RUNNING = {
  runId: 'r1',
  courseId: 'ds',
  tabId: 't1',
  status: 'running',
  action: '공지를 찾는 중',
  url: 'https://a.ac.kr/'
}

describe('useAgentRuns', () => {
  beforeEach(() => {
    useAgentRuns.setState({ byTab: {} })
    useAgentRuns.getState().init()
  })

  test('a running state shows on its tab', () => {
    push(RUNNING)
    expect(useAgentRuns.getState().byTab['t1']?.action).toBe('공지를 찾는 중')
  })

  test('only the tab being driven gets a strip', () => {
    push(RUNNING)
    expect(useAgentRuns.getState().byTab['t2']).toBeUndefined()
  })

  test('later steps replace the line', () => {
    push(RUNNING)
    push({ ...RUNNING, action: '3주차 자료를 여는 중' })
    expect(useAgentRuns.getState().byTab['t1']?.action).toBe(
      '3주차 자료를 여는 중'
    )
  })

  test('a finished run leaves nothing behind', () => {
    push(RUNNING)
    push({ ...RUNNING, status: 'done', action: '' })
    expect(useAgentRuns.getState().byTab['t1']).toBeUndefined()
  })

  test('a stopped run stays visible, so the student sees it took effect', () => {
    push(RUNNING)
    push({ ...RUNNING, status: 'stopped', action: '중지했어요' })
    expect(useAgentRuns.getState().byTab['t1']?.status).toBe('stopped')
  })

  test('a waiting run stays visible so 계속 can be pressed', () => {
    push(RUNNING)
    push({ ...RUNNING, status: 'waiting', action: '로그인하고 계속을 눌러 주세요' })
    expect(useAgentRuns.getState().byTab['t1']?.status).toBe('waiting')
  })

  test('two tabs are independent', () => {
    push(RUNNING)
    push({ ...RUNNING, runId: 'r2', tabId: 't2', action: '다른 일' })
    expect(useAgentRuns.getState().byTab['t1']?.action).toBe('공지를 찾는 중')
    expect(useAgentRuns.getState().byTab['t2']?.action).toBe('다른 일')
  })

  test('init is idempotent — one subscription however many mounts', () => {
    useAgentRuns.getState().init()
    useAgentRuns.getState().init()
    push(RUNNING)
    expect(useAgentRuns.getState().byTab['t1']).toBeDefined()
  })
})
