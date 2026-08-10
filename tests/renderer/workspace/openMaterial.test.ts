import { beforeEach, describe, expect, test, vi } from 'vitest'

const { invokeMock, openTabMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openTabMock: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: invokeMock
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({
  useMaterialsStore: {
    getState: () => ({ activeCourseId: 'course-1' })
  }
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({ openTab: openTabMock })
  }
}))

import { openMaterialInCourse } from '../../../src/renderer/src/features/workspace/openMaterial'

describe('openMaterialInCourse', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    openTabMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
  })

  test('opens an image tab and records material activity', () => {
    openMaterialInCourse('course-1', 'image', 'figures/diagram.png')

    expect(openTabMock).toHaveBeenCalledWith({
      kind: 'image',
      payload: { courseId: 'course-1', relPath: 'figures/diagram.png' }
    })
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('activity:record', {
      courseId: 'course-1',
      kind: 'material-opened',
      relPath: 'figures/diagram.png',
      summary: 'figures/diagram.png을(를) 열었습니다.'
    })
  })

  test('keeps other files on the Finder reveal path', async () => {
    openMaterialInCourse('course-1', 'other', 'archive.zip')
    await Promise.resolve()

    expect(openTabMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'materials:reveal', {
      courseId: 'course-1',
      relPath: 'archive.zip'
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'activity:record', {
      courseId: 'course-1',
      kind: 'material-opened',
      relPath: 'archive.zip',
      summary: 'archive.zip을(를) 열었습니다.'
    })
  })
})
