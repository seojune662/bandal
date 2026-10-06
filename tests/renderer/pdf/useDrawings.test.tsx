// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CreateDrawingInput, Drawing, UpdateDrawingInput } from '../../../src/shared/types/drawing'
import { useDrawings, type DrawingsApi } from '../../../src/renderer/src/features/pdf/tools/useDrawings'
import { usePdfToolStore } from '../../../src/renderer/src/features/pdf/tools/toolStore'

const { invoke, listeners } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Set<(payload: { courseId: string }) => void>()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke,
  onPush: (_channel: string, listener: (payload: { courseId: string }) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(cause: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no }), resolve, reject }
}

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
const style = { color: 'ink' as const, width: 0.002, opacity: 1, fontSizePt: 14 }

function input(text: string, relPath = 'first.pdf'): CreateDrawingInput {
  return { courseId: 'course', relPath, page: 1, kind: 'textbox', data: { box, text }, style }
}

function drawing(id: string, text: string, relPath = 'first.pdf'): Drawing {
  return { ...input(text, relPath), id, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' }
}

describe('PDF drawing saves and history', () => {
  let container: HTMLDivElement
  let root: Root
  let api: DrawingsApi
  let rows: Map<string, Drawing>
  let nextId: number

  function Harness({ relPath }: { relPath: string }): null {
    api = useDrawings('course', relPath)
    return null
  }

  function transport(channel: string, request: unknown): Promise<unknown> {
    if (channel === 'drawings:listForFile') {
      const { relPath } = request as { relPath: string }
      return Promise.resolve([...rows.values()].filter((row) => row.relPath === relPath))
    }
    if (channel === 'drawings:create') {
      const created: Drawing = { ...request as CreateDrawingInput, id: `saved-${++nextId}`,
        createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' }
      rows.set(created.id, created)
      return Promise.resolve(created)
    }
    if (channel === 'drawings:update') {
      const update = request as UpdateDrawingInput
      const previous = rows.get(update.id)
      if (previous === undefined) return Promise.reject(new Error('missing drawing'))
      const updated: Drawing = { ...previous, ...update }
      rows.set(updated.id, updated)
      return Promise.resolve(updated)
    }
    if (channel === 'drawings:delete') {
      for (const id of (request as { ids: string[] }).ids) rows.delete(id)
      return Promise.resolve(undefined)
    }
    return Promise.reject(new Error(`Unexpected channel ${channel}`))
  }

  async function mount(relPath = 'first.pdf'): Promise<void> {
    await act(async () => { root.render(<Harness relPath={relPath} />) })
  }

  beforeEach(() => {
    rows = new Map()
    nextId = 0
    invoke.mockReset().mockImplementation(transport)
    listeners.clear()
    usePdfToolStore.setState({ histories: {} })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  test('keeps multiple textbox contents independent during partial style edits', async () => {
    await mount()
    await act(async () => { await api.create(input('first')); await api.create(input('second')) })
    const first = api.drawings[0]!
    await act(async () => { await api.update({ id: first.id, style: { ...style, bold: true } }) })
    expect(api.drawings.map((item) => item.data.text)).toEqual(['first', 'second'])
    expect(api.drawings[0]?.style.bold).toBe(true)
    expect(api.drawings[1]?.style.bold).toBeUndefined()
  })

  test('serializes edits so a failed text save cannot contaminate the next style edit or undo', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    const failed = deferred<Drawing>()
    invoke.mockImplementation((channel: string, request: unknown) =>
      channel === 'drawings:update' && (request as UpdateDrawingInput).data?.text === 'failed text'
        ? failed.promise : transport(channel, request))
    let first!: Promise<Drawing | null>
    let second!: Promise<Drawing | null>
    await act(async () => {
      first = api.update({ id: 'original', data: { box, text: 'failed text' } })
      second = api.update({ id: 'original', style: { ...style, color: 'blue' } })
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'drawings:update')).toHaveLength(1)
    await act(async () => { failed.reject(new Error('disk full')); await Promise.all([first, second]) })
    expect(api.drawings[0]?.data.text).toBe('original text')
    expect(api.drawings[0]?.style.color).toBe('blue')
    await act(async () => api.undo())
    expect(api.drawings[0]?.data.text).toBe('original text')
    expect(api.drawings[0]?.style.color).toBe('ink')
    expect(api.canUndo).toBe(false)
  })

  test('previews rapid re-edits and newly created boxes immediately while earlier saves are pending', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    const firstSave = deferred<Drawing>()
    const secondSave = deferred<Drawing>()
    let updateCount = 0
    invoke.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'drawings:update') return ++updateCount === 1 ? firstSave.promise : secondSave.promise
      return transport(channel, request)
    })
    let first!: Promise<Drawing | null>
    let second!: Promise<Drawing | null>
    let creation!: Promise<Drawing | null>
    await act(async () => { first = api.update({ id: 'original', data: { box, text: 'first edit' } }) })
    await act(async () => {
      second = api.update({ id: 'original', data: { box, text: 'second edit' } })
      creation = api.create(input('another box'))
    })
    expect(api.drawings.map((item) => item.data.text).sort()).toEqual(['another box', 'second edit'])
    expect(api.drawings.find((item) => item.data.text === 'another box')?.id).toMatch(/^pending:/)
    await act(async () => {
      const updated = drawing('original', 'first edit')
      rows.set(updated.id, updated)
      firstSave.resolve(updated)
      await first
    })
    expect(api.drawings.map((item) => item.data.text).sort()).toEqual(['another box', 'second edit'])
    expect(updateCount).toBe(2)
    await act(async () => {
      const updated = drawing('original', 'second edit')
      rows.set(updated.id, updated)
      secondSave.resolve(updated)
      await Promise.all([second, creation])
    })
    expect(api.drawings.map((item) => item.data.text).sort()).toEqual(['another box', 'second edit'])
    expect(api.drawings.every((item) => !item.id.startsWith('pending:'))).toBe(true)
    invoke.mockImplementation(transport)
    await act(async () => api.undo())
    await act(async () => api.undo())
    expect(api.drawings[0]?.data.text).toBe('first edit')
  })

  test('defers material refreshes until saves finish and discards older list responses', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    const staleList = deferred<Drawing[]>()
    let nextListIsStale = true
    const saved = deferred<Drawing>()
    invoke.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'drawings:listForFile' && nextListIsStale) {
        nextListIsStale = false
        return staleList.promise
      }
      if (channel === 'drawings:update') return saved.promise
      return transport(channel, request)
    })
    await act(async () => { for (const listener of listeners) listener({ courseId: 'course' }) })
    let update!: Promise<Drawing | null>
    await act(async () => {
      update = api.update({ id: 'original', data: { box, text: 'new text' } })
      for (const listener of listeners) listener({ courseId: 'course' })
    })
    await act(async () => { staleList.resolve([drawing('original', 'original text')]); await staleList.promise })
    expect(api.drawings[0]?.data.text).toBe('new text')
    await act(async () => {
      const updated = drawing('original', 'new text')
      rows.set(updated.id, updated)
      rows.set('external', drawing('external', 'added externally'))
      saved.resolve(updated)
      await update
    })
    expect(api.drawings.map((item) => item.data.text)).toEqual(['new text', 'added externally'])
    expect(api.loading).toBe(false)
  })

  test('finishes a save in its original file without changing the newly opened file or reviving history', async () => {
    rows.set('original', drawing('original', 'first file'))
    rows.set('other', drawing('other', 'second file', 'second.pdf'))
    await mount()
    const saved = deferred<Drawing>()
    invoke.mockImplementation((channel: string, request: unknown) =>
      channel === 'drawings:update' ? saved.promise : transport(channel, request))
    let update!: Promise<Drawing | null>
    await act(async () => { update = api.update({ id: 'original', data: { box, text: 'changed first' } }) })
    await mount('second.pdf')
    await act(async () => { saved.resolve(drawing('original', 'changed first')); await update })
    expect(api.drawings.map((item) => item.data.text)).toEqual(['second file'])
    expect(api.error).toBeNull()
    expect(usePdfToolStore.getState().histories).toEqual({})
  })

  test('resolves a pending textbox id for edits and deletion queued before creation finishes', async () => {
    await mount()
    const saved = deferred<Drawing>()
    invoke.mockImplementation((channel: string, request: unknown) =>
      channel === 'drawings:create' ? saved.promise : transport(channel, request))
    let creation!: Promise<Drawing | null>
    await act(async () => { creation = api.create(input('created')) })
    const pendingId = api.drawings[0]!.id
    expect(pendingId).toMatch(/^pending:/)
    let update!: Promise<Drawing | null>
    let removal!: Promise<boolean>
    await act(async () => {
      update = api.update({ id: pendingId, data: { box, text: 'edited pending' } })
      removal = api.remove([pendingId])
    })
    expect(api.drawings).toEqual([])
    await act(async () => {
      const created = drawing('durable', 'created')
      rows.set(created.id, created)
      saved.resolve(created)
      await Promise.all([creation, update, removal])
    })
    expect(api.resolveId?.(pendingId)).toBe('durable')
    expect(await update).toMatchObject({ id: 'durable', data: { text: 'edited pending' } })
    expect(await removal).toBe(true)
    expect(api.drawings).toEqual([])
    expect(rows.size).toBe(0)
    expect(invoke.mock.calls.find(([channel]) => channel === 'drawings:delete')?.[1]).toEqual({ ids: ['durable'] })
  })

  test('undo and redo preserve the full edit history after a deleted textbox receives a new id', async () => {
    await mount()
    let original!: Drawing
    await act(async () => { original = (await api.create(input('before edit')))! })
    await act(async () => { await api.update({ id: original.id, data: { box, text: 'after edit' } }); await api.remove([original.id]) })
    await act(async () => api.undo())
    expect(api.drawings[0]?.data.text).toBe('after edit')
    expect(api.drawings[0]?.id).not.toBe(original.id)
    await act(async () => api.undo())
    expect(api.drawings[0]?.data.text).toBe('before edit')
    await act(async () => api.undo())
    expect(api.drawings).toEqual([])
    await act(async () => api.redo())
    expect(api.drawings[0]?.data.text).toBe('before edit')
    await act(async () => api.redo())
    expect(api.drawings[0]?.data.text).toBe('after edit')
    await act(async () => api.redo())
    expect(api.drawings).toEqual([])
    expect(api.canRedo).toBe(false)
    expect(api.error).toBeNull()
  })

  test('healing a box captured before a save preserves the latest text and inline formatting', async () => {
    rows.set('original', drawing('original', 'old text'))
    await mount()
    const saved = deferred<Drawing>()
    let firstUpdate = true
    invoke.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'drawings:update' && firstUpdate) { firstUpdate = false; return saved.promise }
      return transport(channel, request)
    })
    const data = { box, text: 'new text', textRuns: [{ from: 0, to: 3, style: { bold: true } }] }
    const healedBox = { ...box, height: 0.2 }
    let update!: Promise<Drawing | null>
    let refine!: Promise<Drawing | null>
    await act(async () => {
      update = api.update({ id: 'original', data })
      refine = api.refine({ id: 'original', data: { box: healedBox, text: 'old text' } })
    })
    await act(async () => {
      const updated = { ...drawing('original', 'new text'), data }
      rows.set(updated.id, updated)
      saved.resolve(updated)
      await Promise.all([update, refine])
    })
    expect(api.drawings[0]?.data).toEqual({ ...data, box: healedBox })
    await act(async () => api.undo())
    expect(api.drawings[0]?.data.text).toBe('old text')
    expect(api.canUndo).toBe(false)
  })

  test('flush waits for additional writes queued while it is draining', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    const firstSave = deferred<Drawing>()
    const secondSave = deferred<Drawing>()
    let updateCount = 0
    invoke.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'drawings:update') return ++updateCount === 1 ? firstSave.promise : secondSave.promise
      return transport(channel, request)
    })
    let first!: Promise<Drawing | null>
    let second!: Promise<Drawing | null>
    let flushed = false
    let flush!: Promise<void>
    await act(async () => {
      first = api.update({ id: 'original', data: { box, text: 'first edit' } })
      flush = api.flush!().then(() => { flushed = true })
    })
    await act(async () => { second = api.update({ id: 'original', data: { box, text: 'last edit' } }) })
    await act(async () => {
      const updated = drawing('original', 'first edit')
      rows.set(updated.id, updated)
      firstSave.resolve(updated)
      await first
    })
    expect(flushed).toBe(false)
    await act(async () => {
      const updated = drawing('original', 'last edit')
      rows.set(updated.id, updated)
      secondSave.resolve(updated)
      await Promise.all([second, flush])
    })
    expect(flushed).toBe(true)
    expect(rows.get('original')?.data.text).toBe('last edit')
  })

  test('flush reports a failed save instead of exporting the older persisted text', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    invoke.mockImplementation((channel: string, request: unknown) =>
      channel === 'drawings:update' ? Promise.reject(new Error('save failed')) : transport(channel, request))
    await act(async () => { await api.update({ id: 'original', data: { box, text: 'new text' } }) })
    await expect(api.flush!()).rejects.toThrow('save failed')
    expect(rows.get('original')?.data.text).toBe('original text')
  })

  test('keeps a failed save visible and blocks export after a successful material refresh', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    const failedSave = deferred<Drawing>()
    invoke.mockImplementation((channel: string, request: unknown) =>
      channel === 'drawings:update' ? failedSave.promise : transport(channel, request))
    let update!: Promise<Drawing | null>
    let flush!: Promise<string | null>
    await act(async () => {
      update = api.update({ id: 'original', data: { box, text: 'unsaved edit' } })
      for (const listener of listeners) listener({ courseId: 'course' })
      flush = api.flush!().then(() => null, (cause: Error) => cause.message)
    })
    await act(async () => {
      failedSave.reject(new Error('save failed'))
      await Promise.all([update, flush])
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'drawings:listForFile')).toHaveLength(2)
    expect(await flush).toBe('save failed')
    expect(api.error).toBe('save failed')
    expect(api.drawings[0]?.data.text).toBe('original text')
  })

  test('rolls back a partial restore when one of the deleted textboxes cannot be recreated', async () => {
    await mount()
    let first!: Drawing
    let second!: Drawing
    await act(async () => {
      first = (await api.create(input('first')))!
      second = (await api.create(input('second')))!
      await api.remove([first.id, second.id])
    })
    invoke.mockImplementation((channel: string, request: unknown) =>
      channel === 'drawings:create' && (request as CreateDrawingInput).data.text === 'second'
        ? Promise.reject(new Error('restore failed')) : transport(channel, request))
    await act(async () => api.undo())
    expect(api.drawings).toEqual([])
    expect(rows.size).toBe(0)
    expect(api.error).toBe('restore failed')
    expect(api.canUndo).toBe(true)
    expect(api.canRedo).toBe(false)
    invoke.mockImplementation(transport)
    await act(async () => api.undo())
    expect(api.drawings.map((item) => item.data.text)).toEqual(['first', 'second'])
    expect(api.error).toBeNull()
  })

  test('keeps a newer edit visible while an earlier undo is saving', async () => {
    rows.set('original', drawing('original', 'original text'))
    await mount()
    await act(async () => { await api.update({ id: 'original', data: { box, text: 'edited text' } }) })
    const undoSave = deferred<Drawing>()
    const nextSave = deferred<Drawing>()
    let updateCount = 0
    invoke.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'drawings:update') return ++updateCount === 1 ? undoSave.promise : nextSave.promise
      return transport(channel, request)
    })
    let undo!: Promise<void>
    let update!: Promise<Drawing | null>
    await act(async () => { undo = api.undo() })
    await act(async () => { update = api.update({ id: 'original', data: { box, text: 'newest edit' } }) })
    expect(api.drawings[0]?.data.text).toBe('newest edit')
    await act(async () => {
      const restored = drawing('original', 'original text')
      rows.set(restored.id, restored)
      undoSave.resolve(restored)
      await undo
    })
    expect(api.drawings[0]?.data.text).toBe('newest edit')
    await act(async () => {
      const updated = drawing('original', 'newest edit')
      rows.set(updated.id, updated)
      nextSave.resolve(updated)
      await update
    })
    expect(api.canRedo).toBe(false)
    invoke.mockImplementation(transport)
    await act(async () => api.undo())
    expect(api.drawings[0]?.data.text).toBe('original text')
  })

  test('locks duplicate undo calls synchronously and completes only one history action', async () => {
    await mount()
    await act(async () => { await api.create(input('first')); await api.create(input('second')) })
    await act(async () => { await Promise.all([api.undo(), api.undo()]) })
    expect(api.drawings.map((item) => item.data.text)).toEqual(['first'])
    expect(api.canUndo).toBe(true)
    expect(api.canRedo).toBe(true)
  })

  test('rolls back a partially failed multi-box undo and leaves the action available to retry', async () => {
    const first = drawing('first', 'first before')
    const second = drawing('second', 'second before')
    rows.set(first.id, { ...first, data: { box, text: 'first after' } })
    rows.set(second.id, { ...second, data: { box, text: 'second after' } })
    await mount()
    // The hook's instance key is intentionally private; take it from its first edit.
    await act(async () => { await api.update({ id: first.id, style }) })
    const key = Object.keys(usePdfToolStore.getState().histories)[0]!
    usePdfToolStore.setState({ histories: { [key]: { undo: [{ kind: 'update', drawings: [first, second] }], redo: [] } } })
    invoke.mockImplementation((channel: string, request: unknown) => {
      if (channel === 'drawings:update' && (request as UpdateDrawingInput).id === second.id) {
        return Promise.reject(new Error('second save failed'))
      }
      return transport(channel, request)
    })
    await act(async () => api.undo())
    expect(api.drawings.map((item) => item.data.text)).toEqual(['first after', 'second after'])
    expect(rows.get(first.id)?.data.text).toBe('first after')
    expect(api.error).toBe('second save failed')
    expect(api.canUndo).toBe(true)
    expect(api.canRedo).toBe(false)
  })
})
