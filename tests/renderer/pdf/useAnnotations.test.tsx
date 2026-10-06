// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Annotation, CreateAnnotationInput } from '../../../src/shared/types/annotation'
import { useAnnotations, type AnnotationsApi } from '../../../src/renderer/src/features/pdf/useAnnotations'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no }), resolve, reject }
}
const input: CreateAnnotationInput = {
  courseId: 'course', relPath: 'first.pdf', page: 1, color: 'yellow',
  rects: [{ x: 0, y: 0, width: 0.2, height: 0.1 }],
  anchor: { quote: 'quote', prefix: '', suffix: '' }, comment: null
}
const row: Annotation = { ...input, comment: null, id: 'highlight', createdAt: '', updatedAt: '' }
let root: Root
let container: HTMLDivElement
let api: AnnotationsApi
function Harness({ relPath = 'first.pdf' }: { relPath?: string }) {
  api = useAnnotations('course', relPath)
  return null
}
beforeEach(() => {
  invoke.mockReset().mockResolvedValue([])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

test('does not lose a new highlight behind a slow initial read', async () => {
  const load = deferred<Annotation[]>()
  invoke.mockImplementation((channel: string) => channel === 'annotations:listForFile' ? load.promise : Promise.resolve(row))
  await act(async () => root.render(<Harness />))
  let created!: Promise<Annotation | null>
  await act(async () => { created = api.create(input) })
  expect(invoke).toHaveBeenCalledTimes(1)
  await act(async () => { load.resolve([]); await created })
  expect(api.annotations).toEqual([row])
  expect(api.loading).toBe(false)
})

test('queues recoloring, memo edits and delete in order and exports only after they finish', async () => {
  const first = deferred<Annotation>()
  invoke.mockResolvedValueOnce([row])
  await act(async () => root.render(<Harness />))
  invoke.mockImplementation((channel: string, request: { color?: string }) => {
    if (channel === 'annotations:update' && request.color) return first.promise
    if (channel === 'annotations:update') return Promise.resolve({ ...row, color: 'blue', comment: 'memo' })
    return Promise.resolve({ ok: true })
  })
  let saved!: Promise<unknown[]>
  let flushed = false
  await act(async () => {
    saved = Promise.all([api.update({ id: row.id, color: 'blue' }), api.update({ id: row.id, comment: 'memo' }), api.remove(row.id)])
    void api.flush!().then(() => { flushed = true })
  })
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['annotations:listForFile', 'annotations:update'])
  expect(flushed).toBe(false)
  await act(async () => { first.resolve({ ...row, color: 'blue' }); await saved })
  expect(api.annotations).toEqual([])
  expect(flushed).toBe(true)
})

test('isolates the new file from a prior file save and immediately hides its annotations', async () => {
  invoke.mockResolvedValueOnce([row])
  await act(async () => root.render(<Harness />))
  const saving = deferred<Annotation>()
  const nextLoad = deferred<Annotation[]>()
  invoke.mockImplementation((channel: string) => channel === 'annotations:create' ? saving.promise : nextLoad.promise)
  let pending!: Promise<Annotation | null>
  await act(async () => { pending = api.create(input) })
  await act(async () => root.render(<Harness relPath="second.pdf" />))
  expect(api.annotations).toEqual([])
  await act(async () => { saving.resolve(row); await pending; nextLoad.resolve([]) })
  expect(api.annotations).toEqual([])
  expect(await api.create(input)).toBeNull()
})

test('does not hide an initial read error after a subsequent successful write', async () => {
  invoke.mockRejectedValueOnce(new Error('read failed'))
  await act(async () => root.render(<Harness />))
  invoke.mockResolvedValue(row)
  await act(async () => { await api.create(input) })
  expect(api.error).toBe('read failed')
  await expect(api.flush!()).rejects.toThrow('read failed')
})

test('retains a failed memo across popover closure and offers a durable retry', async () => {
  invoke.mockResolvedValueOnce([row])
  await act(async () => root.render(<Harness />))
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => { await api.update({ id: row.id, comment: 'Do not lose this memo' }) })
  expect(api.annotations[0]?.comment).toBe('Do not lose this memo')
  expect(api.hasUnsavedUpdates).toBe(true)
  // An unrelated recoloring ACK must neither erase the memo nor its error.
  invoke.mockResolvedValueOnce({ ...row, color: 'blue' })
  await act(async () => { await api.update({ id: row.id, color: 'blue' }) })
  expect(api.error).toBe('disk full')
  expect(api.annotations[0]).toMatchObject({ comment: 'Do not lose this memo', color: 'blue' })
  await expect(api.flush!()).rejects.toThrow('disk full')
  invoke.mockResolvedValueOnce({ ...row, color: 'blue', comment: 'Do not lose this memo' })
  await act(async () => { await api.retryUpdates!() })
  expect(api.hasUnsavedUpdates).toBe(false)
  expect(api.error).toBeNull()
  expect(invoke).toHaveBeenLastCalledWith('annotations:update', { id: row.id, comment: 'Do not lose this memo' })
})
