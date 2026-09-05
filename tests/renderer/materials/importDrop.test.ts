import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  pathForFile: vi.fn<(file: File) => string>(),
  courses: [] as Array<{ id: string; folderPath: string }>
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  pathForFile: harness.pathForFile
}))

vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: {
    getState: () => ({ courses: harness.courses })
  }
}))

vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({
  useMaterialsStore: { getState: () => ({ loadTree: vi.fn() }) }
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

import {
  classifyDrop,
  isSelfMaterialDrop,
  relPathInsideCourse
} from '../../../src/renderer/src/features/materials/importDrop'
import {
  beginMaterialFileDrag,
  clearMaterialFileDrag
} from '../../../src/renderer/src/features/materials/materialFileDrag'
import { MATERIAL_MOVE_MIME } from '../../../src/renderer/src/features/materials/materialMoveDrag'
import { canAcceptUrlDrop } from '../../../src/renderer/src/features/materials/urlDrop'

// node 환경 — materialFileDrag 의 window 리스너를 위해 EventTarget 스텁.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeEach(() => {
  const stub = new EventTarget() as EventTarget & { setTimeout: typeof setTimeout }
  stub.setTimeout = ((handler: () => void, delay?: number) =>
    setTimeout(handler, delay)) as typeof setTimeout
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: stub
  })
})

afterEach(() => {
  clearMaterialFileDrag()
  harness.pathForFile.mockReset()
  harness.courses = []
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window
  } else {
    Object.defineProperty(globalThis, 'window', originalWindow)
  }
})

describe('relPathInsideCourse', () => {
  test('resolves paths inside the course folder', () => {
    expect(relPathInsideCourse('/u/과목/자료/강의.pdf', '/u/과목')).toBe(
      '자료/강의.pdf'
    )
    expect(relPathInsideCourse('/elsewhere/강의.pdf', '/u/과목')).toBeNull()
  })

  test('matches across NFC/NFD unicode normalization', () => {
    // macOS 디스크 경로(NFD)와 드롭 경로(NFC)가 정규형만 다를 때도 과목 안이다 —
    // 어긋나면 이동(no-op) 대신 가져오기(복사 + "이름 (2)" 개명)로 새서 복제가 생긴다.
    const folderNfd = '/u/항공우주공학입문'.normalize('NFD')
    const droppedNfc = '/u/항공우주공학입문/대학글쓰기.pdf'.normalize('NFC')
    expect(relPathInsideCourse(droppedNfc, folderNfd)).toBe(
      '대학글쓰기.pdf'.normalize('NFC')
    )

    const folderNfc = '/u/항공우주공학입문'.normalize('NFC')
    const droppedNfd = '/u/항공우주공학입문/대학글쓰기.pdf'.normalize('NFD')
    expect(relPathInsideCourse(droppedNfd, folderNfc)).toBe(
      '대학글쓰기.pdf'.normalize('NFC')
    )
  })
})

describe('classifyDrop', () => {
  test('classifies an in-app material move', () => {
    expect(classifyDrop([MATERIAL_MOVE_MIME], () => '', [])).toEqual({
      kind: 'move'
    })
  })

  test('prefers a DownloadURL over the accompanying Files type', () => {
    const values: Record<string, string> = {
      DownloadURL: 'application/pdf:강의.pdf:https://example.com/lecture.pdf'
    }

    expect(
      classifyDrop(
        ['Files', 'DownloadURL'],
        (type) => values[type] ?? '',
        []
      )
    ).toEqual({
      kind: 'url',
      url: 'https://example.com/lecture.pdf',
      fileName: '강의.pdf'
    })
  })

  test('classifies actual files when no URL is available', () => {
    expect(
      classifyDrop(['Files'], () => '', [new File([], '강의.pdf')])
    ).toEqual({ kind: 'files' })
  })

  test('rejects an empty Files promise without a URL', () => {
    expect(classifyDrop(['Files'], () => '', [])).toEqual({
      kind: 'unsupported'
    })
  })
})

describe('canAcceptUrlDrop', () => {
  test('accepts URL types alongside Files, but not Files alone or moves', () => {
    expect(canAcceptUrlDrop(['Files', 'DownloadURL'])).toBe(true)
    expect(canAcceptUrlDrop(['Files'])).toBe(false)
    expect(canAcceptUrlDrop([MATERIAL_MOVE_MIME, 'text/plain'])).toBe(false)
  })
})

describe('isSelfMaterialDrop', () => {
  const COURSE = { id: 'c1', folderPath: '/u/과목' }

  test('false when no material drag is in flight', () => {
    expect(isSelfMaterialDrop('c1', [])).toBe(false)
  })

  test('trusts the drag state when files are empty (synthetic events)', () => {
    beginMaterialFileDrag({ courseId: 'c1', relPath: 'a.pdf', kind: 'pdf' })
    expect(isSelfMaterialDrop('c1', [])).toBe(true)
    expect(isSelfMaterialDrop('other-course', [])).toBe(false)
  })

  test('true only when the dropped file is the dragged material', () => {
    harness.courses = [COURSE]
    beginMaterialFileDrag({ courseId: 'c1', relPath: '자료/강의.pdf', kind: 'pdf' })

    harness.pathForFile.mockReturnValue('/u/과목/자료/강의.pdf')
    expect(isSelfMaterialDrop('c1', [new File([], '강의.pdf')])).toBe(true)

    harness.pathForFile.mockReturnValue('/u/과목/자료/다른파일.pdf')
    expect(isSelfMaterialDrop('c1', [new File([], '다른파일.pdf')])).toBe(false)

    harness.pathForFile.mockReturnValue('/Users/me/Downloads/강의.pdf')
    expect(isSelfMaterialDrop('c1', [new File([], '강의.pdf')])).toBe(false)
  })

  test('matches the dragged relPath across unicode normalization', () => {
    harness.courses = [COURSE]
    beginMaterialFileDrag({
      courseId: 'c1',
      relPath: '강의자료.pdf'.normalize('NFD'),
      kind: 'pdf'
    })
    harness.pathForFile.mockReturnValue(
      '/u/과목/강의자료.pdf'.normalize('NFC')
    )
    expect(isSelfMaterialDrop('c1', [new File([], '강의자료.pdf')])).toBe(true)
  })
})
