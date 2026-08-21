import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserDownloadUpdate } from '../../../src/shared/ipc/events'

const mocks = vi.hoisted(() => ({
  onDownload: null as ((update: BrowserDownloadUpdate) => void) | null,
  showToast: vi.fn(),
  showToastWithAction: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(async () => ({ ok: true })),
  onPush: vi.fn((channel: string, callback: (update: BrowserDownloadUpdate) => void) => {
    if (channel === 'browser:download') mocks.onDownload = callback
    return () => undefined
  })
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: mocks.showToast,
  showToastWithAction: mocks.showToastWithAction
}))

import { useDownloads } from '../../../src/renderer/src/features/browser/downloadsStore'

function progressing(receivedBytes: number): BrowserDownloadUpdate {
  return {
    id: 'download-1',
    webContentsId: 10,
    fileName: '강의자료.pdf',
    receivedBytes,
    totalBytes: 300,
    state: 'progressing',
    relPath: null,
    courseId: null,
    failureReason: null
  }
}

beforeEach(() => {
  mocks.showToast.mockReset()
  mocks.showToastWithAction.mockReset()
  useDownloads.setState({ downloads: [], activeCount: 0, targetCourseId: null })
})

describe('downloadsStore notices', () => {
  test('shows once for three progress events and resets after terminal states', () => {
    useDownloads.getState().init()

    mocks.onDownload?.(progressing(10))
    mocks.onDownload?.(progressing(100))
    mocks.onDownload?.(progressing(200))

    expect(mocks.showToast).toHaveBeenCalledOnce()
    expect(mocks.showToast).toHaveBeenCalledWith(
      '강의자료.pdf은(는) 다운로드 폴더에 저장됩니다.'
    )

    mocks.onDownload?.({
      ...progressing(200),
      state: 'interrupted',
      failureReason: 'network'
    })
    mocks.onDownload?.(progressing(1))

    expect(
      mocks.showToast.mock.calls.filter(([message]) =>
        String(message).includes('다운로드 폴더에 저장됩니다.')
      )
    ).toHaveLength(2)

    mocks.onDownload?.({ ...progressing(1), state: 'completed' })
    mocks.onDownload?.(progressing(1))

    expect(
      mocks.showToast.mock.calls.filter(([message]) =>
        String(message).includes('다운로드 폴더에 저장됩니다.')
      )
    ).toHaveLength(3)

    mocks.onDownload?.({ ...progressing(1), state: 'interrupted' })
  })
})
