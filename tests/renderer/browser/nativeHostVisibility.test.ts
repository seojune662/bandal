import { expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { setNativeHostBlocked } from '../../../src/renderer/src/features/browser/nativeHostVisibility'
import { acquirePointerPassthrough } from '../../../src/renderer/src/features/browser/webviewPassthrough'

test('nested overlays keep the native host hidden until the last owner releases it', () => {
  const settings = acquirePointerPassthrough()
  const board = acquirePointerPassthrough()
  setNativeHostBlocked('modal-surfaces', true)
  settings(); settings(); board()
  expect(ipc.invoke).toHaveBeenCalledTimes(1)
  expect(ipc.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: true })
  setNativeHostBlocked('modal-surfaces', false)
  expect(ipc.invoke).toHaveBeenCalledTimes(2)
  expect(ipc.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: false })
})
