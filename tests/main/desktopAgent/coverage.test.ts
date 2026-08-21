import { describe, expect, test } from 'vitest'
import {
  AGENT_DESKTOP_TOOLS,
  DESKTOP_CAPABILITIES,
  NOT_FOR_AGENT_DESKTOP
} from '../../../src/main/features/desktopAgent/coverage'
import { DESKTOP_TOOL_DEFINITIONS } from '../../../src/main/features/desktopAgent/schemas'
import { DESKTOP_TOOL_NAMES } from '../../../src/main/features/agentTools/schemas'

describe('agent desktop coverage', () => {
  test('every capability is either given to the agent or refused with a reason', () => {
    const undecided = DESKTOP_CAPABILITIES.filter(
      (capability) =>
        AGENT_DESKTOP_TOOLS[capability.id] === undefined &&
        NOT_FOR_AGENT_DESKTOP[capability.id] === undefined
    )
    expect(undecided.map((capability) => capability.id)).toEqual([])
  })

  test('every mapped tool exists and every definition is read-only', () => {
    const missing = Object.entries(AGENT_DESKTOP_TOOLS)
      .filter(
        ([, tool]) =>
          !(DESKTOP_TOOL_NAMES as readonly string[]).includes(tool)
      )
      .map(([id, tool]) => `${id} → ${tool}`)
    expect(missing).toEqual([])
    expect(DESKTOP_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(
      DESKTOP_TOOL_NAMES
    )
    expect(
      DESKTOP_TOOL_DEFINITIONS.every(
        (tool) =>
          tool.annotations?.readOnlyHint === true &&
          tool.annotations.destructiveHint === false
      )
    ).toBe(true)
  })

  test('a capability is not both given and refused', () => {
    const both = Object.keys(AGENT_DESKTOP_TOOLS).filter(
      (id) => NOT_FOR_AGENT_DESKTOP[id] !== undefined
    )
    expect(both).toEqual([])
  })

  test('every refusal carries a real reason', () => {
    const thin = Object.entries(NOT_FOR_AGENT_DESKTOP)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([id]) => id)
    expect(thin).toEqual([])
  })

  test('the maps do not name capabilities that were removed', () => {
    const known = new Set(DESKTOP_CAPABILITIES.map((capability) => capability.id))
    const stale = [
      ...Object.keys(AGENT_DESKTOP_TOOLS),
      ...Object.keys(NOT_FOR_AGENT_DESKTOP)
    ].filter((id) => !known.has(id))
    expect(stale).toEqual([])
  })
})
