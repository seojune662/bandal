/**
 * The app grew a capability; did the agent?
 *
 * 학기 그룹 shipped in v0.8.2 — repo, IPC, drag-and-drop — and eleven releases
 * later the agent still had no tool for it. A student who asked to change the
 * semester watched the assistant click around a university website instead,
 * because the browser was the only surface it could see.
 *
 * Nothing caught that, because there was no list to be missing from. This is
 * that list, and this test is what makes forgetting loud.
 */
import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/ipc/contract'
import {
  AGENT_CHANNEL_TOOLS,
  NOT_FOR_AGENT,
  WORKSPACE_PREFIXES
} from '../../../src/main/features/agentTools/coverage'
import { AGENT_TOOL_NAMES } from '../../../src/main/features/agentTools/schemas'

/** Reads do not change anything, so they need no agent counterpart. */
const READ_VERBS =
  /^(list|get|read|search|tree|tail|upcoming|resolve|current|find|range|forMaterial|recent|graph)/i

function workspaceMutations(): string[] {
  return (IPC_CHANNELS as readonly string[]).filter((channel) => {
    const [prefix, verb] = channel.split(':')
    if (prefix === undefined || verb === undefined) return false
    if (!WORKSPACE_PREFIXES.includes(prefix)) return false
    return !READ_VERBS.test(verb)
  })
}

describe('agent capability coverage', () => {
  test('every workspace mutation is either given to the agent or refused with a reason', () => {
    const undecided = workspaceMutations().filter(
      (channel) =>
        AGENT_CHANNEL_TOOLS[channel] === undefined &&
        NOT_FOR_AGENT[channel] === undefined
    )

    expect(
      undecided,
      undecided.length === 0
        ? ''
        : [
            '',
            '이 채널들은 앱의 워크스페이스를 바꾸는데 에이전트가 쓸 수 없고,',
            '왜 안 되는지도 적혀 있지 않습니다:',
            ...undecided.map((channel) => `  · ${channel}`),
            '',
            'src/main/features/agentTools/coverage.ts 에서 둘 중 하나를 하세요:',
            '  1) 도구를 만들고 AGENT_CHANNEL_TOOLS 에 매핑하거나',
            '  2) NOT_FOR_AGENT 에 이유를 적으세요.',
            '"아직 안 했다"는 이유가 아닙니다 — 그게 바로 이 테스트가',
            '보이게 하려는 상태입니다.',
            ''
          ].join('\n')
    ).toEqual([])
  })

  test('every mapped tool actually exists', () => {
    // A mapping that names a tool nobody built is worse than no mapping: it
    // reports coverage that is not there.
    const missing = Object.entries(AGENT_CHANNEL_TOOLS)
      .filter(([, tool]) => !(AGENT_TOOL_NAMES as readonly string[]).includes(tool))
      .map(([channel, tool]) => `${channel} → ${tool}`)
    expect(missing).toEqual([])
  })

  test('board reordering is covered by the existing task update tool', () => {
    expect(AGENT_CHANNEL_TOOLS['board:reorderTasks']).toBe('update_task')
  })

  test('a channel is not both given and refused', () => {
    const both = Object.keys(AGENT_CHANNEL_TOOLS).filter(
      (channel) => NOT_FOR_AGENT[channel] !== undefined
    )
    expect(both).toEqual([])
  })

  test('every refusal carries a real reason', () => {
    const thin = Object.entries(NOT_FOR_AGENT)
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([channel]) => channel)
    expect(thin).toEqual([])
  })

  test('the map does not name channels that no longer exist', () => {
    // Otherwise a deleted feature leaves behind coverage that reads as real.
    const known = new Set(IPC_CHANNELS as readonly string[])
    const stale = [
      ...Object.keys(AGENT_CHANNEL_TOOLS),
      ...Object.keys(NOT_FOR_AGENT)
    ].filter((channel) => !known.has(channel))
    expect(stale).toEqual([])
  })
})
