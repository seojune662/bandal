import { EventEmitter } from 'node:events'
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { expect, test, vi } from 'vitest'
import { createLearningApprovalDialogs } from '../../../src/main/features/learning/approvalDialogs'
import { createAgentConfirmer } from '../../../src/main/features/agentTools/confirm'

function fixture() {
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false), isVisible: vi.fn(() => true), webContents: { isDestroyed: vi.fn(() => false) }
  })
  let finish!: (answer: MessageBoxReturnValue) => void
  const show = vi.fn((_owner: BrowserWindow, _options: MessageBoxOptions) => new Promise<MessageBoxReturnValue>(resolve => { finish = resolve }))
  const dialogs = createLearningApprovalDialogs({ getOwner: () => owner as unknown as BrowserWindow, show })
  return { owner, show, dialogs, finish: (response: number) => finish({ response, checkboxChecked: false }) }
}

test('uses a live visible parent and one cancelable native dialog per request, cleaning up after a response', async () => {
  const { owner, show, dialogs, finish } = fixture()
  const first = dialogs.request('one', { message: 'Read this site?', buttons: ['Cancel', 'Allow'] })
  expect(dialogs.request('one', { message: 'Duplicate' })).toBe(first)
  expect(show).toHaveBeenCalledTimes(1)
  expect(show.mock.calls[0]![0]).toBe(owner)
  expect(show.mock.calls[0]![1].signal?.aborted).toBe(false)
  expect(owner.listenerCount('closed')).toBe(1)
  finish(1)
  expect(await first).toMatchObject({ response: 1 })
  expect(owner.listenerCount('closed')).toBe(0)
})

test('fails closed with no visible live app window and never opens a parentless dialog', async () => {
  const { owner, show } = fixture()
  for (const getOwner of [() => null, () => owner as unknown as BrowserWindow]) {
    owner.isVisible.mockReturnValue(false)
    expect(await createLearningApprovalDialogs({ getOwner, show }).request('one', { message: 'Approval' })).toBeNull()
  }
  owner.isVisible.mockReturnValue(true)
  owner.isDestroyed.mockReturnValue(true)
  expect(await createLearningApprovalDialogs({ getOwner: () => owner as unknown as BrowserWindow, show }).request('one', { message: 'Approval' })).toBeNull()
  owner.isDestroyed.mockReturnValue(false)
  owner.webContents.isDestroyed.mockReturnValue(true)
  expect(await createLearningApprovalDialogs({ getOwner: () => owner as unknown as BrowserWindow, show }).request('one', { message: 'Approval' })).toBeNull()
  expect(show).not.toHaveBeenCalled()
})

test('parent close, explicit cancellation and shutdown reject even a late always-allow response', async () => {
  for (const cancel of ['close', 'cancel', 'shutdown'] as const) {
    const { owner, show, dialogs, finish } = fixture()
    const result = dialogs.request('pack', { message: 'Run installed pack?', buttons: ['Cancel', 'Allow once', 'Always allow'] })
    if (cancel === 'close') owner.emit('closed')
    else if (cancel === 'cancel') dialogs.cancel('pack')
    else dialogs.dispose()
    expect(show.mock.calls[0]![1].signal?.aborted).toBe(true)
    finish(2)
    expect(await result).toBeNull()
    expect(owner.listenerCount('closed')).toBe(0)
    if (cancel === 'shutdown') expect(await dialogs.request('next', { message: 'Approval' })).toBeNull()
  }
})

test('a parent destroyed before the reply cannot approve and native failures clean up', async () => {
  const { owner, show, dialogs, finish } = fixture()
  const result = dialogs.request('one', { message: 'Approval' })
  owner.isDestroyed.mockReturnValue(true)
  finish(1)
  expect(await result).toBeNull()
  owner.isDestroyed.mockReturnValue(false)
  show.mockRejectedValueOnce(new Error('native failure'))
  expect(await dialogs.request('next', { message: 'Approval' })).toBeNull()
  show.mockImplementationOnce(() => { throw new Error('synchronous native failure') })
  expect(await dialogs.request('last', { message: 'Approval' })).toBeNull()
  expect(owner.listenerCount('closed')).toBe(0)
})

test('canceling the actual confirmer closes its study dialog and late replies cannot restore approval', async () => {
  const { show, dialogs, finish } = fixture()
  const confirmer = createAgentConfirmer({
    emit: request => { void dialogs.request(request.requestId, { message: request.summary }).then(answer => confirmer.resolve({ requestId: request.requestId, approved: answer?.response === 1, scope: 'once' })) },
    changed: state => { if (state.status !== 'pending') dialogs.cancel(state.request.requestId) }
  })
  const answer = confirmer.confirm({ courseId: 'course', conversationId: 'study', tool: 'browser_access', summary: 'Read this site?', details: [] })
  confirmer.cancelConversation('study')
  expect(await answer).toBe(false)
  expect(show.mock.calls[0]![1].signal?.aborted).toBe(true)
  finish(1)
  await Promise.resolve(); await Promise.resolve()
  expect(confirmer.list('study')[0]!.status).toBe('cancelled')
})
