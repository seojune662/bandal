import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createBrowserTools } from '../../../src/main/features/browserAgent/browserTools'
import { createAuditRepo } from '../../../src/main/features/browserAgent/audit'
import { createGrantsRepo } from '../../../src/main/features/browserAgent/grants'
import { createSeenRepo } from '../../../src/main/features/browserAgent/seenRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('browser agent master switch', () => {
  let context: TestDb

  beforeEach(() => {
    context = createTestDb()
  })

  afterEach(() => context.cleanup())

  test('refuses browser tools before touching the browser', () => {
    const openTabs = vi.fn(() => ({
      tabs: [],
      activeTabId: null
    }))
    const tools = createBrowserTools({
      courseId: 'course-1',
      getRunId: () => 'run-1',
      getAgentUse: () => false,
      grants: createGrantsRepo(context.db),
      audit: createAuditRepo(context.db),
      seen: createSeenRepo(context.db),
      courseLinks: () => [],
      specFor: () => null,
      fetch: async () => new Response(),
      confirm: async () => false,
      openTabs
    })

    expect(tools.browser_tabs()).toEqual({
      status: 'error',
      message: '브라우저 에이전트 사용이 설정에서 꺼져 있어요'
    })
    expect(openTabs).not.toHaveBeenCalled()
  })
})
