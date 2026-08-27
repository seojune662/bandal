import { describe, expect, test } from 'vitest'
import type { AgentToolsDeps } from '../../../src/main/features/agentTools/tools'
import { createAgentTools } from '../../../src/main/features/agentTools/tools'

function text(result: Awaited<ReturnType<ReturnType<typeof createAgentTools>['call']>>): string {
  const block = result.content[0]
  return block?.type === 'text' ? block.text : ''
}

function depsWith(allowed: ReadonlySet<string>): AgentToolsDeps {
  return {
    courseId: 'course-a',
    getTurnId: () => 'turn-a',
    coursesRepo: {} as AgentToolsDeps['coursesRepo'],
    courseGroupsRepo: {} as AgentToolsDeps['courseGroupsRepo'],
    materialsRepo: {} as AgentToolsDeps['materialsRepo'],
    materialLinksRepo: {} as AgentToolsDeps['materialLinksRepo'],
    courseLinksRepo: {} as AgentToolsDeps['courseLinksRepo'],
    favoritesRepo: {} as AgentToolsDeps['favoritesRepo'],
    searchIndex: {} as AgentToolsDeps['searchIndex'],
    linkService: {} as AgentToolsDeps['linkService'],
    notesRepo: {} as AgentToolsDeps['notesRepo'],
    boardRepo: {} as AgentToolsDeps['boardRepo'],
    canvasRepo: {} as AgentToolsDeps['canvasRepo'],
    confirm: async () => true,
    journal: { record: () => undefined },
    packRunGuard: { restrictionFor: () => allowed }
  }
}

describe('agentTools pack run guard hook', () => {
  test('lets reads pass while blocking undeclared mutations and UI tools', async () => {
    const tools = createAgentTools(depsWith(new Set()))

    const read = await tools.call('app_state')
    expect(read.isError).not.toBe(true)

    for (const name of ['create_note', 'browser_read', 'desktop_screenshot']) {
      const result = await tools.call(name)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain(
        `이 실행은 팩이 선언한 도구만 쓸 수 있어요: ${name} 은 선언되지 않았어요`
      )
    }
  })

  test('does not reject a declared mutation at the pack boundary', async () => {
    const tools = createAgentTools(depsWith(new Set(['create_note'])))
    const result = await tools.call('create_note')

    expect(text(result)).not.toContain('팩이 선언한 도구만')
    expect(result.isError).toBe(true) // It reached normal argument validation.
  })
})
