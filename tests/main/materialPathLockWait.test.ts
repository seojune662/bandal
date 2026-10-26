import { expect, test, vi } from 'vitest'
import { withMaterialPathLockWait } from '../../src/main/features/materials/materialPathLock'

test('background work waits for a busy project path and executes once after acquisition', async () => {
  const release = vi.fn()
  const tryAcquire = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(undefined).mockReturnValue(release)
  const action = vi.fn(async () => 'migrated')
  await expect(withMaterialPathLockWait({ tryAcquire }, action, { delayMs: 0 })).resolves.toBe('migrated')
  expect(tryAcquire).toHaveBeenCalledTimes(3)
  expect(action).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledOnce()
})

test('a persistent lock remains an actionable error and does not start the migration', async () => {
  const action = vi.fn(async () => undefined)
  await expect(withMaterialPathLockWait({ tryAcquire: () => undefined }, action, { attempts: 1, delayMs: 0 })).rejects.toThrow('기존 노트 이전을 시작하지 못했습니다')
  expect(action).not.toHaveBeenCalled()
})

test('real migration errors are preserved and never retried', async () => {
  const release = vi.fn()
  const action = vi.fn(async () => { throw new Error('Invalid legacy note') })
  await expect(withMaterialPathLockWait({ tryAcquire: () => release }, action, { delayMs: 0 })).rejects.toThrow('Invalid legacy note')
  expect(action).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
})

test('a timed-out user mutation keeps its conflict error without running the operation', async () => {
  const error = new Error('자료 경로 변경 대기 시간 초과')
  const action = vi.fn(async () => undefined)
  await expect(withMaterialPathLockWait({ tryAcquire: () => undefined }, action,
    { attempts: 1, delayMs: 0, timeoutError: () => error })).rejects.toBe(error)
  expect(action).not.toHaveBeenCalled()
})
