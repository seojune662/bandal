import { expect, test } from 'vitest'
import { normalizeAssistantPanel } from '../../../src/renderer/src/features/assistantPanel/panelContext'
import { registerDocumentContext, readDocumentContexts } from '../../../src/renderer/src/features/agent/documentContext'
test('new tab panels are closed, AI first, bounded, and have independent conversations', () => {
  const first = normalizeAssistantPanel(undefined), second = normalizeAssistantPanel(undefined)
  expect(first).toMatchObject({ open: false, section: 'ai', width: 320 })
  expect(first.conversationId).not.toBe(second.conversationId)
  expect(normalizeAssistantPanel({ ...first, width: 30 }).width).toBe(280)
  expect(normalizeAssistantPanel({ ...first, width: 900 }).width).toBe(480)
  expect(normalizeAssistantPanel({ ...first, width: NaN }).width).toBe(320)
  expect(normalizeAssistantPanel({ ...first, open: true, section: 'highlights', courseId: 'c' })).toMatchObject({ conversationId: first.conversationId, open: true, section: 'highlights', courseId: 'c' })
})
test('same file in split panels has separate page, selection, and reader lifetime', () => {
  const base = { courseId: 'c', relPath: 'file.pdf', title: 'file', kind: 'pdf' }
  const offA = registerDocumentContext('original', () => ({ ...base, page: 2, selection: 'first' }))
  const offB = registerDocumentContext('duplicate', () => ({ ...base, page: 9, selection: 'second' }))
  const broken = registerDocumentContext('duplicate', () => { throw new Error('closed reader') })
  expect(readDocumentContexts()).toEqual([{ ...base, page: 2, selection: 'first', documentId: 'original' }, { ...base, page: 9, selection: 'second', documentId: 'duplicate', unavailable: true }])
  broken(); offA()
  expect(readDocumentContexts()).toEqual([{ ...base, page: 9, selection: 'second', documentId: 'duplicate' }])
  offB(); expect(readDocumentContexts()).toEqual([])
})
