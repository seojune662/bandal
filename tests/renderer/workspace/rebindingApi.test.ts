import { expect, test, vi } from 'vitest'
import { createRebindingApi } from '../../../src/renderer/src/features/workspace/rebindingApi'

function api(title: string) {
  const listeners = new Set<(event: { title: string }) => void>()
  return { id: 'same-panel', title, isActive: true, isVisible: true,
    setTitle: vi.fn(function (this: { title: string }, value: string) { this.title = value; for (const listener of listeners) listener({ title: value }) }),
    onDidTitleChange: (listener: (event: { title: string }) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) } }, listeners }
}

test('a callback captured before a move reaches the new owner and subscriptions remain live', () => {
  const source = api('source'), target = api('target'), wrapper = createRebindingApi(source)
  const delayedTitle = wrapper.api.setTitle
  const changed = vi.fn()
  const subscription = wrapper.api.onDidTitleChange(changed)
  wrapper.rebind(target)
  expect(source.listeners.size).toBe(0)
  delayedTitle('finished after moving')
  expect(source.setTitle).not.toHaveBeenCalled()
  expect(target.setTitle).toHaveBeenCalledWith('finished after moving')
  expect(wrapper.api.title).toBe('finished after moving')
  expect(changed).toHaveBeenLastCalledWith({ title: 'finished after moving' })
  subscription.dispose()
  expect(target.listeners.size).toBe(0)
  wrapper.dispose()
})
