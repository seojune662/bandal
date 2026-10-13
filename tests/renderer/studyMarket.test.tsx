// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { initialSaleSelection, saleMaterials, sellerProceeds, validPrice, errorMessage } from '../../src/renderer/src/features/studyMarket/presentation'
import type { MaterialNode } from '../../src/shared/types/materials'
import type { StudyMarketListing } from '../../src/shared/types/studyMarket'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn(), flush: vi.fn() }))
vi.mock('../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../src/renderer/src/features/studyMarket/api', () => ({ marketRequest: mocks.request, readCourseBindings: () => ({}), saveCourseBinding: vi.fn() }))
vi.mock('../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ flushOpenNoteSession: mocks.flush }))
vi.mock('../../src/renderer/src/stores/coursesStore', () => {
  const state = { courses: [{ id: 'local-course', name: '경제학원론', archived: false, missing: false, workspaceKind: 'course' }] }
  return { useCoursesStore: (selector: (value: typeof state) => unknown) => selector(state) }
})
import { SaleDialog } from '../../src/renderer/src/features/studyMarket/SaleDialog'

const notes: MaterialNode[] = [{ name: 'notes.md', relPath: 'notes.md', kind: 'note', size: 120 }, { name: 'week1', relPath: 'week1', kind: 'dir', children: [{ name: 'slides.pdf', relPath: 'week1/slides.pdf', kind: 'pdf', size: 300 }] }, { name: 'script.js', relPath: 'script.js', kind: 'other', size: 15 }, { name: 'link.bandal', relPath: 'link.bandal', kind: 'other', size: 20 }]

describe('study market selection and amounts', () => {
  test('keeps unsupported executable and link formats out of sale selection', () => {
    expect(saleMaterials(notes).map(file => file.relPath)).toEqual(['notes.md', 'week1/slides.pdf'])
  })
  test('requires explicit file selection and does not silently sell an entire folder', () => {
    const files = saleMaterials(notes)
    expect(initialSaleSelection(files)).toEqual([])
    expect(initialSaleSelection(files, 'week1')).toEqual([])
    expect(initialSaleSelection(files, 'notes.md')).toEqual(['notes.md'])
  })
  test('keeps the all-in commission and KRW integer bounds consistent with the server', () => {
    expect(validPrice('1')).toBe(1)
    expect(validPrice('1000000000')).toBe(1_000_000_000)
    for (const value of ['', '0', '-10', '1.1', '1e5', '1000000001']) expect(validPrice(value)).toBeNull()
    expect(sellerProceeds(1001)).toBe(901)
  })
  test('retains actionable validation messages without exposing remote error boilerplate', () => {
    expect(errorMessage(new Error("Error invoking remote method 'studyMarket:prepare': Error: 자료가 변경되었어요."))).toBe('자료가 변경되었어요.')
    expect(errorMessage(new Error('school_mismatch'))).toContain('대학교')
    expect(errorMessage(new Error('secret_internal_exception'))).not.toContain('secret_internal_exception')
  })
})

describe('sale dialog transaction boundaries', () => {
  let container: HTMLDivElement
  let root: Root
  const courses = [{ id: 'common-course', universityId: 'snu', name: '경제학원론' }]
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    mocks.invoke.mockImplementation(async (channel: string) => channel === 'materials:tree' ? notes : { ok: true })
    mocks.flush.mockResolvedValue(null)
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  const render = async (draft: StudyMarketListing | null = null): Promise<void> => {
    await act(async () => { root.render(<SaleDialog universityId="snu" universityName="서울대학교" marketCourses={courses} intent={null} draft={draft} canPublish={false} onClose={() => {}} onSaved={() => {}} />) })
  }
  test('shows a keyboard-accessible dialog and disables preparation until a file is chosen', async () => {
    await render()
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    const next = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '다음')!
    expect(next.disabled).toBe(true)
    expect(container.textContent).not.toContain('script.js')
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(next.disabled).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalledWith('studyMarket:prepare', expect.anything())
  })
  test('refuses to snapshot a note with unsaved conflicts', async () => {
    mocks.flush.mockResolvedValue({ result: { status: 'conflict' } })
    await render()
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '다음')!.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('저장하지 못한 필기')
    expect(mocks.invoke).not.toHaveBeenCalledWith('studyMarket:prepare', expect.anything())
  })
  test('keeps drafts editable while preventing publication before the seller and trading are ready', async () => {
    const draft: StudyMarketListing = { id: 'listing', versionId: 'version', universityId: 'snu', course: courses[0]!, sellerId: 'seller', sellerName: '학생', title: '중간고사 필기', description: '직접 정리한 공부 자료', price: 2000, professor: '', semester: '', status: 'draft', files: [{ id: 'file', path: 'notes.md', bytes: 120, mime: 'text/markdown', sha256: 'a'.repeat(64) }], previewUrls: ['data:image/png;base64,YQ=='], createdAt: '', updatedAt: '' }
    await render(draft)
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '임시 저장')!
    expect(save.disabled).toBe(false)
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '공개 전 확인')!.click())
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === '판매 시작')!.disabled).toBe(true)
    expect(container.textContent).toContain('판매자 등록과 거래 준비')
  })
})
