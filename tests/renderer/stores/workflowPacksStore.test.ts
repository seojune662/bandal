import { afterEach, expect, test, vi } from 'vitest'
import type { WorkflowPackSummary } from '../../../src/shared/types/workflowPack'
import type { PushPayload } from '../../../src/shared/ipc/events'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'
import { resetWorkflowPacksStoreForTests, useWorkflowPacksStore } from '../../../src/renderer/src/stores/workflowPacksStore'
import { useStudyToolsStore } from '../../../src/renderer/src/features/study/studyToolsStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

const quiz: WorkflowPackSummary = { pack: BUILTIN_PACKS.find(pack => pack.id === 'quiz')!, source: 'builtin', enabled: true, approvedAt: null }
afterEach(() => { resetWorkflowPacksStoreForTests(); setIpcAdapter(null) })

function transport(list: () => Promise<{ packs: WorkflowPackSummary[] }>) {
  let changed: ((event: PushPayload<'packs:changed'>) => void) | undefined
  const invoke = vi.fn(async (channel: string) => channel === 'packs:list' ? list() : { ok: true })
  const unsubscribe = vi.fn()
  setIpcAdapter({ invoke, on: (channel: string, callback: typeof changed) => { if (channel === 'packs:changed') changed = callback; return unsubscribe } } as unknown as IpcAdapter)
  return { invoke, unsubscribe, push: (packs: WorkflowPackSummary[]) => changed?.({ packs }) }
}

test('deduplicates initial reads and mirrors full scope metadata into the existing study menu', async () => {
  let finish!: (value: { packs: WorkflowPackSummary[] }) => void
  const host = transport(() => new Promise(resolve => { finish = resolve }))
  const first = useWorkflowPacksStore.getState().load()
  const second = useStudyToolsStore.getState().loadTools()
  expect(host.invoke).toHaveBeenCalledTimes(1)
  finish({ packs: [quiz] })
  await Promise.all([first, second])
  expect(useStudyToolsStore.getState().tools[0]).toMatchObject({ id: 'quiz', schemaVersion: 2, experience: 'quiz', worksOn: quiz.pack.worksOn })
  await useStudyToolsStore.getState().loadTools()
  expect(host.invoke).toHaveBeenCalledTimes(1)
})

test('a newer install/disable/remove push wins over an in-flight stale list and refreshes study menus immediately', async () => {
  let finish!: (value: { packs: WorkflowPackSummary[] }) => void
  const host = transport(() => new Promise(resolve => { finish = resolve }))
  const reading = useWorkflowPacksStore.getState().load()
  const installed: WorkflowPackSummary = { ...quiz, source: 'user', pack: { ...quiz.pack, id: 'custom:quiz' } }
  host.push([quiz, installed])
  host.push([{ ...quiz, enabled: false }, installed])
  finish({ packs: [quiz] }); await reading
  expect(useWorkflowPacksStore.getState().packs).toHaveLength(2)
  expect(useStudyToolsStore.getState().tools[0]?.enabled).toBe(false)
  host.push([installed])
  expect(useStudyToolsStore.getState().tools.map(tool => tool.id)).toEqual(['custom:quiz'])
})

test('acknowledged mutations refresh hosts without pushes, and rejected mutations retain the current registry', async () => {
  let enabled = true
  const host = transport(async () => ({ packs: [{ ...quiz, enabled }] }))
  await useWorkflowPacksStore.getState().load()
  enabled = false
  await useWorkflowPacksStore.getState().setEnabled('quiz', false)
  expect(host.invoke).toHaveBeenCalledWith('packs:setEnabled', { id: 'quiz', enabled: false })
  expect(useStudyToolsStore.getState().tools[0]?.enabled).toBe(false)
  host.invoke.mockRejectedValueOnce(new Error('Cannot remove builtin'))
  await expect(useWorkflowPacksStore.getState().remove('quiz')).rejects.toThrow('Cannot remove builtin')
  expect(useWorkflowPacksStore.getState().packs).toHaveLength(1)
})

test('ignores late reads after reset and releases the shared push subscription', async () => {
  let finish!: (value: { packs: WorkflowPackSummary[] }) => void
  const host = transport(() => new Promise(resolve => { finish = resolve }))
  const reading = useWorkflowPacksStore.getState().load()
  resetWorkflowPacksStoreForTests()
  finish({ packs: [quiz] }); await reading
  expect(useWorkflowPacksStore.getState().packs).toEqual([])
  expect(host.unsubscribe).toHaveBeenCalledOnce()
})
