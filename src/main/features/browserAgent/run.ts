/**
 * The glass box.
 *
 * While the agent is driving a page, the student sees a strip on that tab
 * saying what it is doing, with a 중지 button. This is not decoration: it is
 * the mitigation for every reliability failure mode in this feature. A model
 * that misreads a Korean portal will do something visibly wrong, and the only
 * thing that turns "the agent did something weird" into "I stopped it" is a
 * person watching a real tab.
 *
 * It is also why the agent gets a VISIBLE tab rather than a hidden one — and
 * that choice has a second benefit: Chromium background-throttles a guest it
 * considers occluded, which would make agent runs mysteriously slow.
 */

import { randomUUID } from 'node:crypto'

export type RunStatus = 'running' | 'waiting' | 'stopped' | 'done'

export interface RunState {
  runId: string
  courseId: string
  tabId: string
  status: RunStatus
  /** One short line: what it is doing right now. */
  action: string
  url: string
}

export class RunStopped extends Error {
  constructor() {
    super('학생이 중지했어요.')
    this.name = 'RunStopped'
  }
}

export interface RunRegistryDeps {
  emit: (state: RunState) => void
}

/**
 * One run at a time per course. A second concurrent run would mean two
 * strips, two stop buttons and no way for a student to tell which is which.
 */
export function createRunRegistry(deps: RunRegistryDeps) {
  const runs = new Map<string, RunState>()

  function publish(state: RunState): void {
    runs.set(state.runId, state)
    deps.emit(state)
  }

  return {
    start(courseId: string, tabId: string, action: string, url: string): RunState {
      const state: RunState = {
        runId: randomUUID(),
        courseId,
        tabId,
        status: 'running',
        action,
        url
      }
      publish(state)
      return state
    },

    /** Updates the line the student is reading. */
    step(runId: string, action: string, url?: string): void {
      const current = runs.get(runId)
      if (current === undefined || current.status !== 'running') return
      publish({ ...current, action, ...(url === undefined ? {} : { url }) })
    },

    /** Marks a run as waiting on the student (handoff). */
    wait(runId: string, action: string): void {
      const current = runs.get(runId)
      if (current === undefined) return
      publish({ ...current, status: 'waiting', action })
    },

    resume(runId: string): void {
      const current = runs.get(runId)
      if (current === undefined || current.status !== 'waiting') return
      publish({ ...current, status: 'running', action: '이어서 진행하는 중' })
    },

    stop(runId: string): void {
      const current = runs.get(runId)
      if (current === undefined) return
      publish({ ...current, status: 'stopped', action: '중지했어요' })
    },

    finish(runId: string): void {
      const current = runs.get(runId)
      if (current === undefined) return
      publish({ ...current, status: 'done', action: '끝났어요' })
      runs.delete(runId)
    },

    /**
     * Throws once the student has stopped the run. Called before every action
     * so 중지 takes effect at the next step rather than "eventually".
     */
    assertLive(runId: string): void {
      const current = runs.get(runId)
      if (current === undefined) return
      if (current.status === 'stopped') throw new RunStopped()
    },

    /** Binds a run to the tab that was opened for it. */
    attachTab(runId: string, tabId: string): void {
      const current = runs.get(runId)
      if (current === undefined || current.tabId !== '') return
      publish({ ...current, tabId })
    },

    all(): RunState[] {
      return [...runs.values()]
    },

    get(runId: string): RunState | null {
      return runs.get(runId) ?? null
    },

    forCourse(courseId: string): RunState | null {
      for (const state of runs.values()) {
        if (state.courseId === courseId && state.status !== 'done') return state
      }
      return null
    },

    /** Ends everything, so no strip outlives the app. */
    disposeAll(): void {
      for (const [runId, state] of runs) {
        publish({ ...state, status: 'done', action: '' })
        runs.delete(runId)
      }
    },

    /** Ends every run for a course — used when its chat session goes away. */
    disposeCourse(courseId: string): void {
      for (const [runId, state] of runs) {
        if (state.courseId === courseId) {
          publish({ ...state, status: 'done', action: '' })
          runs.delete(runId)
        }
      }
    }
  }
}
