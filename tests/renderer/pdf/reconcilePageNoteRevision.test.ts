import { beforeEach, expect, test, vi } from 'vitest'
import { createPdfPageNoteMarkdown } from '../../../src/shared/pdfPageNote'
import type { MaterialLinkRecord } from '../../../src/shared/types/link'
import { reconcilePageNoteRevision } from '../../../src/renderer/src/features/pdf/reconcilePageNoteRevision'
const mock=vi.hoisted(()=>vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc',()=>({invoke:mock}))
const input={courseId:'course',relPath:'source.pdf',documentRevision:'a'.repeat(64),fingerprint:'new-fingerprint',pageSizes:[{width:400,height:600}],
  record:{id:'link',target:{kind:'note',payload:{courseId:'course',relPath:'note.md'}},metadata:{version:1,syncScroll:true,fingerprint:'old-fingerprint',pageSizes:[{width:400,height:600}]}} as MaterialLinkRecord,cancelled:()=>false}
beforeEach(()=>mock.mockReset())
test('a stale immutable viewer never reads or writes the newer linked note',async()=>{
  mock.mockResolvedValue({documentRevision:'b'.repeat(64)})
  expect(await reconcilePageNoteRevision(input)).toBe('stale')
  expect(mock.mock.calls.map(call=>call[0])).toEqual(['pdfNotes:info'])
})
test('every write carries the exact PDF revision and stops when a concurrent rewrite rejects it',async()=>{
  mock.mockImplementation(async(channel:string)=>{
    if(channel==='pdfNotes:info')return{documentRevision:input.documentRevision}
    if(channel==='notes:read')return{markdown:createPdfPageNoteMarkdown('memo','source.pdf','old-fingerprint',input.pageSizes,['original memo']),mtime:1}
    if(channel==='notes:write')throw new Error('PDF 원본이 변경되었습니다')
  })
  await expect(reconcilePageNoteRevision(input)).rejects.toThrow('PDF 원본')
  expect(mock.mock.calls.find(call=>call[0]==='notes:write')?.[1]).toMatchObject({pageNoteSource:{relPath:'source.pdf',documentRevision:input.documentRevision}})
  expect(mock.mock.calls.some(call=>call[0]==='links:updatePageNote')).toBe(false)
})
test('current viewer updates both note and link with the revision guard',async()=>{
  mock.mockImplementation(async(channel:string)=>channel==='pdfNotes:info'?{documentRevision:input.documentRevision}:channel==='notes:read'?{markdown:createPdfPageNoteMarkdown('memo','source.pdf','old-fingerprint',input.pageSizes,['original memo']),mtime:1}:{})
  expect(await reconcilePageNoteRevision(input)).toBe('updated')
  expect(mock.mock.calls.find(call=>call[0]==='links:updatePageNote')?.[1]).toMatchObject({pageNoteSource:{relPath:'source.pdf',documentRevision:input.documentRevision}})
})
