import { describe, expect, test, vi } from 'vitest'
import {
  createRunRegistry,
  RunStopped
} from '../../../src/main/features/browserAgent/run'

function registry() {
  const emitted: unknown[] = []
  const api = createRunRegistry({ emit: (state) => emitted.push(state) })
  return { api, emitted }
}

describe('run registry (the glass box)', () => {
  test('starting a run announces it, so a strip can appear', () => {
    const { api, emitted } = registry()
    const run = api.start('ds', 't1', '공지를 찾는 중', 'https://a.ac.kr/')
    expect(emitted).toHaveLength(1)
    expect(run.status).toBe('running')
    expect(api.forCourse('ds')?.runId).toBe(run.runId)
  })

  test('each step re-announces what the student is reading', () => {
    const { api, emitted } = registry()
    const run = api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.step(run.runId, '3주차 자료를 여는 중', 'https://a.ac.kr/w3')
    expect(emitted).toHaveLength(2)
    expect(api.get(run.runId)?.action).toBe('3주차 자료를 여는 중')
    expect(api.get(run.runId)?.url).toBe('https://a.ac.kr/w3')
  })

  test('중지 takes effect at the next action, not eventually', () => {
    const { api } = registry()
    const run = api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    expect(() => api.assertLive(run.runId)).not.toThrow()
    api.stop(run.runId)
    expect(() => api.assertLive(run.runId)).toThrow(RunStopped)
  })

  test('a stopped run ignores further steps', () => {
    const { api } = registry()
    const run = api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.stop(run.runId)
    api.step(run.runId, '계속 진행')
    expect(api.get(run.runId)?.status).toBe('stopped')
  })

  test('handoff suspends and resumes', () => {
    const { api } = registry()
    const run = api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.wait(run.runId, '로그인하고 계속을 눌러 주세요')
    expect(api.get(run.runId)?.status).toBe('waiting')
    api.resume(run.runId)
    expect(api.get(run.runId)?.status).toBe('running')
  })

  test('a stopped run cannot be resumed back into life', () => {
    const { api } = registry()
    const run = api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.stop(run.runId)
    api.resume(run.runId)
    expect(api.get(run.runId)?.status).toBe('stopped')
  })

  test('finishing clears it so no stale strip lingers', () => {
    const { api } = registry()
    const run = api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.finish(run.runId)
    expect(api.get(run.runId)).toBeNull()
    expect(api.forCourse('ds')).toBeNull()
  })

  test('courses are independent', () => {
    const { api } = registry()
    api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.start('algo', 't2', 'b', 'https://b.ac.kr/')
    expect(api.forCourse('ds')?.tabId).toBe('t1')
    expect(api.forCourse('algo')?.tabId).toBe('t2')
  })

  test('disposing a course ends its runs', () => {
    const { api } = registry()
    api.start('ds', 't1', 'a', 'https://a.ac.kr/')
    api.disposeCourse('ds')
    expect(api.forCourse('ds')).toBeNull()
  })

  test('unknown run ids are inert, never throwing', () => {
    const { api } = registry()
    const emit = vi.fn()
    expect(() => api.step('nope', 'x')).not.toThrow()
    expect(() => api.stop('nope')).not.toThrow()
    expect(() => api.assertLive('nope')).not.toThrow()
    expect(emit).not.toHaveBeenCalled()
  })
})
