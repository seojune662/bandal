import { expect, test } from 'vitest'
import { assertLiveStudyBrowserSource } from '../../../src/main/features/workflowPacks/browserStudySource'

const source = { courseId: 'course', relPath: null, browserTabId: 'tab', browserTabUrl: 'https://example.com/article' }
const guest = { id: 1, getURL: () => source.browserTabUrl, isDestroyed: () => false }
const owner = { rootId: 1, tabId: 'tab', courseId: 'course' }

test('accepts only the original live native tab in its owning course', () => {
  expect(() => assertLiveStudyBrowserSource(source, guest, owner)).not.toThrow()
  for (const mismatch of [undefined, { ...owner, courseId: 'other' }, { ...owner, tabId: 'other' }]) {
    expect(() => assertLiveStudyBrowserSource(source, guest, mismatch)).toThrow('브라우저 원문')
  }
  expect(() => assertLiveStudyBrowserSource(source, { ...guest, getURL: () => 'https://example.com/moved' }, owner)).toThrow('브라우저 원문')
  expect(() => assertLiveStudyBrowserSource(source, { ...guest, isDestroyed: () => true }, owner)).toThrow('브라우저 원문')
  expect(() => assertLiveStudyBrowserSource(source, null, owner)).toThrow('브라우저 원문')
})

test('rejects URL-only bypasses and mixed file/browser targets while file runs stay compatible', () => {
  expect(() => assertLiveStudyBrowserSource({ ...source, browserTabId: undefined } as unknown as typeof source, guest, owner)).toThrow()
  expect(() => assertLiveStudyBrowserSource({ ...source, relPath: 'note.md' }, guest, owner)).toThrow()
  expect(() => assertLiveStudyBrowserSource({ courseId: 'course', relPath: 'note.md' }, null, undefined)).not.toThrow()
})
