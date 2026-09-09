// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useGroupChat } from '../../../src/renderer/src/features/group/useGroupChat'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke, onPush: () => () => {} }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
function Probe({ readable }: { readable: boolean }): JSX.Element { const chat = useGroupChat('direct1', readable); return <div>{chat.phase}</div> }
let root: Root, host: HTMLDivElement, focused: boolean
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  invoke.mockImplementation(async (channel) => channel === 'groupChat:open' ? {
    group: { id: 'direct1', kind: 'direct' }, myUserId: 'me', lastReadSeq: 0, members: [], pending: [], connection: 'live',
    messages: [{ id: 'm1', groupId: 'direct1', seq: 5, authorId: 'friend', kind: 'text', body: 'hello', replyTo: null, createdAt: '2026-09-09T00:00:00Z', editedAt: null, deleted: false, author: { nickname: '친구', avatarColor: 'blue', avatarEmoji: '🌙' } }]
  } : { ok: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })
const reads = (): unknown[][] => invoke.mock.calls.filter(([channel]) => channel === 'groupChat:markRead')
test('hidden or scrolled-away conversations stay unread until visible, focused and at the bottom', async () => {
  await act(async () => root.render(<Probe readable={false} />))
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(reads()).toHaveLength(0)
  focused = false
  await act(async () => { window.dispatchEvent(new Event('blur')); root.render(<Probe readable />) })
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(reads()).toHaveLength(0)
  focused = true
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => vi.advanceTimersByTimeAsync(800))
  expect(reads()).toEqual([['groupChat:markRead', { groupId: 'direct1', seq: 5 }]])
})
test('failed read receipts retry and do not retry after the conversation is hidden', async () => {
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (channel, input) => { if (channel === 'groupChat:markRead') throw new Error('offline'); return original(channel, input) })
  await act(async () => root.render(<Probe readable />))
  await act(async () => vi.advanceTimersByTimeAsync(800))
  expect(reads()).toHaveLength(1)
  await act(async () => root.render(<Probe readable={false} />))
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(reads()).toHaveLength(1)
})
