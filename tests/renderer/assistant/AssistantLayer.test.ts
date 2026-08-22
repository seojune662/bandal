import { describe, expect, test } from 'vitest'
import { overlayConversationForCourse } from '../../../src/renderer/src/features/assistant/AssistantLayer'
import { orbStateForActivity } from '../../../src/renderer/src/features/assistant/orbActivityState'

describe('AssistantLayer conversation sharing', () => {
  test('uses the main overlay conversation only for the selected course', () => {
    const overlay = {
      courseId: 'course-a',
      conversationId: 'conversation-from-main'
    }

    expect(overlayConversationForCourse('course-a', overlay)).toBe(
      'conversation-from-main'
    )
    expect(overlayConversationForCourse('course-b', overlay)).toBeNull()
    expect(overlayConversationForCourse(null, overlay)).toBeNull()
  })

  test('prioritizes approval and answer alerts over busy state for both orbs', () => {
    expect(
      orbStateForActivity({ busy: true, alert: false, needsApproval: true })
    ).toBe('alert')
    expect(
      orbStateForActivity({ busy: true, alert: true, needsApproval: false })
    ).toBe('alert')
    expect(
      orbStateForActivity({ busy: true, alert: false, needsApproval: false })
    ).toBe('busy')
    expect(
      orbStateForActivity(
        { busy: false, alert: false, needsApproval: false },
        true
      )
    ).toBe('hover')
  })
})
