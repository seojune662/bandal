// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { LearningDialogsHost, requestLearningCreation, requestLearningArticleImport } from '../../../src/renderer/src/features/learning/LearningDialogsHost'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useMaterialsStore } from '../../../src/renderer/src/stores/materialsStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import * as navigation from '../../../src/renderer/src/features/learning/learningNavigation'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
afterEach(() => { if (root) act(() => root?.unmount()); root = null; vi.restoreAllMocks(); setIpcAdapter(null); document.body.replaceChildren() })

test('opening creation from an installed English pack runs that selected recipe after the real form submits', async () => {
  const binding = { courseId: 'new-course', rootRelPath: '' }
  const invoke = vi.fn(async (channel: string) => channel === 'learning:create' ? { binding } : { runId: 'run', binding })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  vi.spyOn(useCoursesStore.getState(), 'loadCourses').mockResolvedValue()
  vi.spyOn(useMaterialsStore.getState(), 'loadTree').mockResolvedValue()
  vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => { root!.render(<LearningDialogsHost />) })
  await act(async () => { requestLearningCreation(undefined, 'custom:space-reading') })
  const topic = document.querySelector<HTMLInputElement>('input[placeholder="예: 우주 탐사, 디자인, 축구, AI"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(topic, 'Space exploration')
    topic.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const form = document.querySelector<HTMLFormElement>('.learning-create__form')!
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(invoke).toHaveBeenCalledWith('learning:create', expect.objectContaining({ topic: 'Space exploration' }))
  expect(invoke).toHaveBeenCalledWith('learning:run', { binding, kind: 'find-articles', packId: 'custom:space-reading' })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('the real article import dialog opens the host-retained duplicate, even with a different normalized source URL', async () => {
  const binding = { courseId: 'course', rootRelPath: 'Reading' }
  const invoke = vi.fn(async (channel: string) => channel === 'learning:list'
    ? { projects: [{ binding, name: 'Reading' }] }
    : { binding, addedArticleId: 'original', articles: [{ id: 'original', sourceUrl: 'https://example.com/original' }, { id: 'last-unrelated', sourceUrl: 'https://example.com/other' }] })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  const open = vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => { root!.render(<LearningDialogsHost />) })
  await act(async () => { requestLearningArticleImport({ courseId: 'course', url: 'https://mirror.example.com/story?utm_source=test#top', tabId: 'browser-source' }) })
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '학습에 추가')!
  await act(async () => { button.click() })
  expect(invoke).toHaveBeenCalledWith('learning:addArticle', { binding, url: 'https://mirror.example.com/story?utm_source=test#top', tabId: 'browser-source' })
  expect(open).toHaveBeenCalledWith(binding, 'reader', 'original')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
