// @vitest-environment jsdom
import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import type { LearningArticleSnapshot, LearningProjectSnapshot } from '../../../src/shared/types/learning'
import { canCloseTab } from '../../../src/renderer/src/features/workspace/tabCloseGuard'
import { useReaderProgress } from '../../../src/renderer/src/features/learning/useReaderProgress'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test('folder move guard waits for an active debounce write and the position queued during it', async () => {
  const binding = { courseId: 'course', rootRelPath: 'Reading' }
  const project = { projectId: 'project', binding, articles: [] } as unknown as LearningProjectSnapshot
  const article = { id: 'article' } as LearningArticleSnapshot
  let complete!: (value: LearningProjectSnapshot) => void
  invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue(project)
  let progress!: ReturnType<typeof useReaderProgress>
  const onError = vi.fn()
  function Host() {
    const element = useRef<HTMLDivElement>(null)
    progress = useReaderProgress(element, project, article, vi.fn(), onError)
    return <div ref={element} />
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<Host />))
  const scroller = host.firstElementChild as HTMLDivElement
  Object.defineProperties(scroller, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } })
  scroller.scrollTop = 200
  act(() => progress.onScroll({ currentTarget: scroller } as React.UIEvent<HTMLDivElement>))
  const earlier = progress.flush()
  let settled = false
  const close = Promise.resolve(canCloseTab({ kind: 'learning-resource', payload: { ...binding, resource: { kind: 'article', id: article.id } } })).then(result => { settled = true; return result })
  await Promise.resolve()
  expect(settled).toBe(false)
  scroller.scrollTop = 400
  act(() => progress.onScroll({ currentTarget: scroller } as React.UIEvent<HTMLDivElement>))
  await act(async () => { complete(project); await earlier; expect(await close).toBe(true) })
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenLastCalledWith('learning:saveProgress', expect.objectContaining({ scrollFraction: 400 / 900 }))
  expect(onError).not.toHaveBeenCalled()
  act(() => root.unmount()); host.remove()
})
