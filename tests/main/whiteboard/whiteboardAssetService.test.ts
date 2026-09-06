import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createWhiteboardAssetService } from '../../../src/main/features/whiteboard/whiteboardAssetService'
import { createTestDb, type TestDb } from '../helpers/testDb'

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'
const ASSET_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const WEBP = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBP', 'binary')

describe('whiteboard asset service', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.cleanup()
  })

  function harness(userId: string | null = USER_ID) {
    const upload = vi.fn(async () => ({ data: {}, error: null }))
    const upsert = vi.fn(async () => ({ data: {}, error: null }))
    const client = {
      storage: {
        from: vi.fn(() => ({ upload, download: vi.fn() }))
      },
      from: vi.fn(() => ({ upsert }))
    } as unknown as SupabaseClient
    const service = createWhiteboardAssetService({
      db: testDb.db,
      repo: {
        getBoardById: (id) => id === BOARD_ID
          ? {
              id: BOARD_ID,
              groupId: GROUP_ID,
              title: '같이 그리기',
              createdBy: USER_ID,
              createdAt: '2026-09-07T00:00:00.000Z',
              updatedAt: '2026-09-07T00:00:00.000Z'
            }
          : null
      },
      userDataPath: testDb.dir,
      getClient: () => userId === null ? null : client,
      getUserId: () => userId
    })
    return { service, upload, upsert }
  }

  test('durably stores, uploads and reads an optimized image', async () => {
    const { service, upload, upsert } = harness()

    const source = await service.put({
      boardId: BOARD_ID,
      assetId: ASSET_ID,
      label: ' 강의 사진 ',
      mimeType: 'image/webp',
      base64: WEBP.toString('base64'),
      widthPx: 640,
      heightPx: 480
    })

    expect(source).toMatchObject({
      storage: 'shared',
      assetId: ASSET_ID,
      label: '강의 사진',
      widthPx: 640,
      heightPx: 480
    })
    expect(upload).toHaveBeenCalledOnce()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ author_id: USER_ID, storage_path: `${GROUP_ID}/${BOARD_ID}/${ASSET_ID}.webp` }),
      { onConflict: 'id' }
    )
    expect(service.isSynced(ASSET_ID)).toBe(true)
    await expect(service.read({ boardId: BOARD_ID, assetId: ASSET_ID }))
      .resolves.toEqual({ encoding: 'base64', data: WEBP.toString('base64') })
    service.dispose()
  })

  test('rejects malformed base64 and mislabeled bytes before touching storage', async () => {
    const { service, upload } = harness()
    const base = {
      boardId: BOARD_ID,
      assetId: ASSET_ID,
      label: '사진',
      mimeType: 'image/webp' as const,
      widthPx: 1,
      heightPx: 1
    }

    await expect(service.put({ ...base, base64: 'not base64' }))
      .rejects.toThrow('encoding')
    await expect(service.put({ ...base, base64: Buffer.from('not-webp').toString('base64') }))
      .rejects.toThrow('valid WebP')
    expect(upload).not.toHaveBeenCalled()
    service.dispose()
  })
})
