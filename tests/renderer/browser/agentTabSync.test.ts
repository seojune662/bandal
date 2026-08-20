/**
 * What the agent is told the student has open.
 *
 * The rule this file exists to protect: a tab the student can see must appear
 * in the list even when its guest is gone. Live guests are capped at
 * MAX_LIVE_GUESTS and the LRU destroys hidden ones, so a listing derived from
 * live guests would silently drop tabs that are plainly on screen — and
 * "what do I have open?" would answer wrongly with total confidence.
 */
import { describe, expect, test } from 'vitest'
import { tabSyncPayload } from '../../../src/renderer/src/features/browser/agentTabSync'
import type { TabDescriptor } from '../../../src/shared/tabs'

function browserTab(tabId: string, initialUrl: string): TabDescriptor {
  return { kind: 'browser', payload: { tabId, initialUrl } } as TabDescriptor
}

const NAV = {
  t1: {
    url: 'https://my.snu.ac.kr/p/ST/',
    title: '서울대학교 포털',
    loading: false,
    canGoBack: false,
    canGoForward: false
  }
}

describe('tabSyncPayload', () => {
  test('publishes the browser tabs of the active course', () => {
    const payload = tabSyncPayload({
      openTabs: { p1: browserTab('t1', 'https://my.snu.ac.kr/') },
      nav: NAV,
      liveTabIds: ['t1'],
      activeTabId: 't1',
      courseId: 'ds'
    })
    expect(payload).toEqual({
      courseId: 'ds',
      tabs: [
        {
          tabId: 't1',
          title: '서울대학교 포털',
          url: 'https://my.snu.ac.kr/p/ST/',
          asleep: false
        }
      ],
      activeTabId: 't1'
    })
  })

  test('an evicted guest is still listed, marked asleep', () => {
    const payload = tabSyncPayload({
      openTabs: { p1: browserTab('t1', 'https://my.snu.ac.kr/') },
      nav: NAV,
      liveTabIds: [],
      activeTabId: null,
      courseId: 'ds'
    })
    expect(payload?.tabs).toHaveLength(1)
    expect(payload?.tabs[0]?.asleep).toBe(true)
  })

  test('falls back to the descriptor URL before the first commit', () => {
    const payload = tabSyncPayload({
      openTabs: { p1: browserTab('t9', 'https://sugang.snu.ac.kr/') },
      nav: {},
      liveTabIds: ['t9'],
      activeTabId: 't9',
      courseId: 'ds'
    })
    expect(payload?.tabs[0]?.url).toBe('https://sugang.snu.ac.kr/')
    expect(payload?.tabs[0]?.title).toBe('')
  })

  test('non-browser tabs are not tabs the agent can read', () => {
    const payload = tabSyncPayload({
      openTabs: {
        p1: { kind: 'note', payload: { courseId: 'ds', relPath: 'a.md' } } as TabDescriptor,
        p2: browserTab('t1', 'https://x/')
      },
      nav: {},
      liveTabIds: ['t1'],
      activeTabId: 't1',
      courseId: 'ds'
    })
    expect(payload?.tabs.map((tab) => tab.tabId)).toEqual(['t1'])
  })

  test('no course selected publishes nothing', () => {
    // Publishing a course-less list would let a later course read it.
    expect(
      tabSyncPayload({
        openTabs: { p1: browserTab('t1', 'https://x/') },
        nav: {},
        liveTabIds: ['t1'],
        activeTabId: 't1',
        courseId: null
      })
    ).toBeNull()
  })

  test('no browser tabs is an empty list, not null', () => {
    // The agent has to be able to learn that the answer is "nothing".
    const payload = tabSyncPayload({
      openTabs: {},
      nav: {},
      liveTabIds: [],
      activeTabId: null,
      courseId: 'ds'
    })
    expect(payload).toEqual({ courseId: 'ds', tabs: [], activeTabId: null })
  })
})
