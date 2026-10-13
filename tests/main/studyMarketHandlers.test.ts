import { describe, expect, it, vi } from 'vitest'
import { registerStudyMarketHandlers } from '../../src/main/ipc/studyMarketHandlers'

const file = { id: 'file-1', path: 'note.md', bytes: 3, sha256: 'a'.repeat(64), mime: 'text/markdown', url: 'https://project.supabase.co/storage/v1/original' }

function fixture(change: Partial<typeof file> = {}, receiptFails = false) {
  const handlers = new Map<string, (input: any) => Promise<any>>()
  let downloads = 0
  const request = vi.fn(async (action: string) => {
    if (action === 'download') return { orderId: 'order-1', title: '공부 자료', courseName: '경제학', files: [{ ...file, ...(downloads++ ? { url: 'https://project.supabase.co/storage/v1/renewed', ...change } : {}) }] }
    if (receiptFails) throw new Error('acknowledgement unavailable')
    return { ok: true }
  })
  const imported = vi.fn(async (input: any) => {
    const first = await input.refreshUrl(file)
    const second = await input.refreshUrl(file)
    expect(first).toBe('https://project.supabase.co/storage/v1/renewed')
    expect(second).toBe(first)
    return { relPath: '구매 자료/공부 자료', files: ['note.md'] }
  })
  const changed = vi.fn()
  registerStudyMarketHandlers(((name: string, handler: any) => handlers.set(name, handler)) as any, {
    client: { request, trustedStorageUrl: (url: string) => {
      if (!url.startsWith('https://project.supabase.co/storage/v1/')) throw new Error('untrusted host')
      return url
    } }, bundles: { importDownload: imported }, changed, createCourse: () => ({ id: 'course-1' })
  } as any)
  return { request, imported, changed, run: () => handlers.get('studyMarket:import')!({ orderId: 'order-1', courseId: 'course-1', acceptSupply: true }) }
}

describe('study market import boundary', () => {
  it('renews URLs while retaining the immutable file identity, with one refresh per batch', async () => {
    const f = fixture()
    await expect(f.run()).resolves.toEqual({ courseId: 'course-1', relPath: '구매 자료/공부 자료' })
    expect(f.request.mock.calls.filter(([action]) => action === 'download')).toHaveLength(2)
    expect(f.changed).toHaveBeenCalledWith('course-1')
  })
  it.each([{ sha256: 'b'.repeat(64) }, { path: '../other.md' }, { url: 'https://attacker.example/file' }])('rejects changed content or foreign URLs during renewal: %o', async change => {
    const f = fixture(change)
    await expect(f.run()).rejects.toThrow()
    expect(f.changed).not.toHaveBeenCalled()
    expect(f.request).toHaveBeenLastCalledWith('downloadComplete', expect.objectContaining({ success: false }))
  })
  it('keeps a successfully imported purchase when its receipt acknowledgement is unavailable', async () => {
    await expect(fixture({}, true).run()).resolves.toEqual({ courseId: 'course-1', relPath: '구매 자료/공부 자료' })
  })
})
