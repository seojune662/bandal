// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (value: any) => void>(), invoke: vi.fn(async () => ({ ok: true })), flush: vi.fn<() => Promise<void>>() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: (channel: string, callback: (value: any) => void) => { mocks.handlers.set(channel, callback); return () => mocks.handlers.delete(channel) } }))
vi.mock('../../../src/renderer/src/features/updates/prepareUpdateInstall', () => ({ prepareUpdateInstall: mocks.flush }))
import { installWorkspaceTransition } from '../../../src/renderer/src/features/documents/workspaceTransition'
afterEach(() => { mocks.handlers.clear(); vi.clearAllMocks(); document.body.innerHTML = '' })
test('input is frozen before flushing and remains frozen until main releases the exact request', async () => {
  const root = document.createElement('div'); root.inert = false
  let complete!: () => void
  mocks.flush.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const dispose = installWorkspaceTransition(root)
  mocks.handlers.get('workspace:prepareTransition')!({ requestId: 'current' })
  expect(root.inert).toBe(true)
  expect(mocks.invoke).not.toHaveBeenCalled()
  complete()
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('workspace:transitionReady', { requestId: 'current', ok: true }))
  mocks.handlers.get('workspace:releaseTransition')!({ requestId: 'old' })
  expect(root.inert).toBe(true)
  mocks.handlers.get('workspace:releaseTransition')!({ requestId: 'current' })
  expect(root.inert).toBe(false)
  dispose()
})
test('a failed editor save sends a failure without document contents and cleanup restores input', async () => {
  const root = document.createElement('div'); root.inert = false
  mocks.flush.mockRejectedValue(new Error('private file content'))
  const dispose = installWorkspaceTransition(root)
  mocks.handlers.get('workspace:prepareTransition')!({ requestId: 'current' })
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('workspace:transitionReady', { requestId: 'current', ok: false }))
  expect(root.inert).toBe(true)
  dispose()
  expect(root.inert).toBe(false)
})
test('freezes existing and newly mounted body portals and shortcuts, restoring each original inert value', async () => {
  const root = document.createElement('main'), sheet = document.createElement('section'), alreadyDisabled = document.createElement('aside')
  root.inert = false; sheet.inert = false; alreadyDisabled.inert = true
  document.body.append(root, sheet, alreadyDisabled)
  mocks.flush.mockResolvedValue(undefined)
  const dispose = installWorkspaceTransition(root)
  mocks.handlers.get('workspace:prepareTransition')!({ requestId: 'all-surfaces' })
  expect(sheet.inert).toBe(true)
  const latePortal = document.createElement('dialog'); latePortal.inert = false
  document.body.append(latePortal)
  await Promise.resolve()
  expect(latePortal.inert).toBe(true)
  const shortcut = new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true, cancelable: true })
  document.body.dispatchEvent(shortcut)
  expect(shortcut.defaultPrevented).toBe(true)
  mocks.handlers.get('workspace:releaseTransition')!({ requestId: 'all-surfaces' })
  expect(root.inert).toBe(false)
  expect(sheet.inert).toBe(false)
  expect(latePortal.inert).toBe(false)
  expect(alreadyDisabled.inert).toBe(true)
  const after = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true })
  document.body.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
  dispose()
})
