import { describe, expect, test } from 'vitest'
import type {
  AgentEvent,
  ToolResultSummary
} from '../../../src/shared/types/agent-events'
import type { ChatMessage } from '../../../src/shared/types/chat'
import {
  appendLocalUserMessage,
  applyAgentEvent,
  applyAgentEvents,
  applyLocalPermissionResponse,
  checkBatchSeq,
  clearNotice,
  hydrateFromHistory,
  initialChatViewState,
  markSendFailed,
  type ChatViewState,
  type PermissionBlockView,
  type TextBlockView,
  type ThinkingBlockView,
  type ToolBlockView
} from '../../../src/renderer/src/features/chat/chatModel'

function lastMessage(state: ChatViewState) {
  const message = state.messages[state.messages.length - 1]
  if (message === undefined) {
    throw new Error('expected at least one message')
  }
  return message
}

function run(events: AgentEvent[], from = initialChatViewState): ChatViewState {
  return applyAgentEvents(from, events)
}

describe('text streaming', () => {
  test('accumulates text-delta events for one blockId in order', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: '안녕' },
      { type: 'text-delta', blockId: 'b1', text: '하세요' }
    ])
    const block = lastMessage(state).blocks[0] as TextBlockView
    expect(block.kind).toBe('text')
    expect(block.text).toBe('안녕하세요')
    expect(block.streaming).toBe(true)
    expect(state.streaming).toBe(true)
  })

  test('text-final REPLACES all accumulated delta content for the blockId', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: 'partial ' },
      { type: 'text-delta', blockId: 'b1', text: 'garbage' },
      { type: 'text-final', blockId: 'b1', text: 'The clean final text.' }
    ])
    const message = lastMessage(state)
    expect(message.blocks).toHaveLength(1)
    const block = message.blocks[0] as TextBlockView
    expect(block.text).toBe('The clean final text.')
    expect(block.streaming).toBe(false)
  })

  test('text-final without prior deltas still creates the block', () => {
    const state = run([{ type: 'text-final', blockId: 'b9', text: 'hello' }])
    const block = lastMessage(state).blocks[0] as TextBlockView
    expect(block.text).toBe('hello')
    expect(block.streaming).toBe(false)
  })

  test('two text blocks stay ordered and independent', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: 'one' },
      { type: 'text-final', blockId: 'b1', text: 'one' },
      { type: 'text-delta', blockId: 'b2', text: 'two' }
    ])
    const blocks = lastMessage(state).blocks as TextBlockView[]
    expect(blocks.map((block) => block.text)).toEqual(['one', 'two'])
    expect(blocks[0]!.streaming).toBe(false)
    expect(blocks[1]!.streaming).toBe(true)
  })
})

describe('thinking blocks (no thinking-final exists)', () => {
  test('thinking finalizes when the next block starts', () => {
    const state = run([
      { type: 'thinking-delta', blockId: 't1', text: '먼저 자료를 ' },
      { type: 'thinking-delta', blockId: 't1', text: '살펴보자' },
      { type: 'text-delta', blockId: 'b1', text: '자료를 보면…' }
    ])
    const [thinking, text] = lastMessage(state).blocks as [
      ThinkingBlockView,
      TextBlockView
    ]
    expect(thinking.kind).toBe('thinking')
    expect(thinking.text).toBe('먼저 자료를 살펴보자')
    expect(thinking.streaming).toBe(false)
    expect(text.streaming).toBe(true)
  })

  test('thinking finalizes on tool-start', () => {
    const state = run([
      { type: 'thinking-delta', blockId: 't1', text: 'hmm' },
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Read', label: 'Reading a.pdf' }
    ])
    const thinking = lastMessage(state).blocks[0] as ThinkingBlockView
    expect(thinking.streaming).toBe(false)
  })

  test('thinking finalizes on turn-complete', () => {
    const state = run([
      { type: 'thinking-delta', blockId: 't1', text: 'hmm' },
      { type: 'turn-complete', stopReason: 'success' }
    ])
    const thinking = lastMessage(state).blocks[0] as ThinkingBlockView
    expect(thinking.streaming).toBe(false)
    expect(state.streaming).toBe(false)
  })
})

describe('tool-start upsert', () => {
  test('bare tool-start then refreshed tool-start merge by toolCallId', () => {
    const state = run([
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Read', label: 'Read' },
      {
        type: 'tool-start',
        toolCallId: 'tc1',
        toolName: 'Read',
        label: 'Reading lecture-3.pdf',
        input: { file_path: '/course/lecture-3.pdf' }
      }
    ])
    const message = lastMessage(state)
    expect(message.blocks).toHaveLength(1)
    const tool = message.blocks[0] as ToolBlockView
    expect(tool.label).toBe('Reading lecture-3.pdf')
    expect(tool.input).toEqual({ file_path: '/course/lecture-3.pdf' })
    expect(tool.status).toBe('running')
  })

  test('refreshed tool-start keeps the original block position', () => {
    const state = run([
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Read', label: 'Read' },
      { type: 'text-delta', blockId: 'b1', text: 'meanwhile' },
      {
        type: 'tool-start',
        toolCallId: 'tc1',
        toolName: 'Read',
        label: 'Reading x',
        input: { file_path: 'x' }
      }
    ])
    const kinds = lastMessage(state).blocks.map((block) => block.kind)
    expect(kinds).toEqual(['tool', 'text'])
  })

  test('refresh without input preserves previously received input', () => {
    const state = run([
      {
        type: 'tool-start',
        toolCallId: 'tc1',
        toolName: 'Grep',
        label: 'Search',
        input: { pattern: 'foo' }
      },
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Grep', label: 'Searching foo' }
    ])
    const tool = lastMessage(state).blocks[0] as ToolBlockView
    expect(tool.input).toEqual({ pattern: 'foo' })
    expect(tool.label).toBe('Searching foo')
  })

  test('tool-input-delta accumulates partial input on the block', () => {
    const state = run([
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Write', label: 'Write' },
      { type: 'tool-input-delta', toolCallId: 'tc1', partialInput: '{"file' },
      { type: 'tool-input-delta', toolCallId: 'tc1', partialInput: '_path":' }
    ])
    const tool = lastMessage(state).blocks[0] as ToolBlockView
    expect(tool.partialInput).toBe('{"file_path":')
  })

  test('tool-end sets ok status and result summary', () => {
    const result: ToolResultSummary = { summary: 'Read 120 lines' }
    const state = run([
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Read', label: 'Read' },
      { type: 'tool-end', toolCallId: 'tc1', ok: true, result }
    ])
    const tool = lastMessage(state).blocks[0] as ToolBlockView
    expect(tool.status).toBe('ok')
    expect(tool.result).toEqual(result)
  })

  test('tool-end with ok:false marks the tool as error', () => {
    const state = run([
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Bash', label: 'Run' },
      { type: 'tool-end', toolCallId: 'tc1', ok: false }
    ])
    const tool = lastMessage(state).blocks[0] as ToolBlockView
    expect(tool.status).toBe('error')
  })
})

describe('permission flow', () => {
  const request: AgentEvent = {
    type: 'permission-request',
    requestId: 'req1',
    toolName: 'Write',
    input: { file_path: 'notes.md' }
  }

  test('permission-request adds a pending block and blocks the turn', () => {
    const state = run([request])
    expect(state.pendingPermissionId).toBe('req1')
    const block = lastMessage(state).blocks[0] as PermissionBlockView
    expect(block.kind).toBe('permission')
    expect(block.toolName).toBe('Write')
    expect(block.behavior).toBeUndefined()
  })

  test('local response resolves the block and clears the pending id', () => {
    const state = applyLocalPermissionResponse(run([request]), 'req1', 'allow')
    expect(state.pendingPermissionId).toBeNull()
    const block = lastMessage(state).blocks[0] as PermissionBlockView
    expect(block.behavior).toBe('allow')
  })

  test('deny response is recorded', () => {
    const state = applyLocalPermissionResponse(run([request]), 'req1', 'deny')
    const block = lastMessage(state).blocks[0] as PermissionBlockView
    expect(block.behavior).toBe('deny')
  })

  test('turn-complete clears an unanswered pending permission', () => {
    const state = run([request, { type: 'turn-complete', stopReason: 'interrupted' }])
    expect(state.pendingPermissionId).toBeNull()
  })
})

describe('turn-complete', () => {
  test('stores usage stats on the finished assistant message', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: 'done' },
      {
        type: 'turn-complete',
        stopReason: 'success',
        durationMs: 12400,
        costUsd: 0.042,
        usage: { inputTokens: 10, outputTokens: 20 }
      }
    ])
    const message = lastMessage(state)
    expect(message.streaming).toBe(false)
    expect(message.interrupted).toBe(false)
    expect(message.stats?.durationMs).toBe(12400)
    expect(message.stats?.costUsd).toBe(0.042)
    expect(state.streaming).toBe(false)
  })

  test('interrupted stop reason marks the message interrupted', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: 'partial answ' },
      { type: 'turn-complete', stopReason: 'interrupted' }
    ])
    const message = lastMessage(state)
    expect(message.interrupted).toBe(true)
    expect(message.streaming).toBe(false)
  })

  test('a tool still running at turn end is settled as error', () => {
    const state = run([
      { type: 'tool-start', toolCallId: 'tc1', toolName: 'Read', label: 'Read' },
      { type: 'turn-complete', stopReason: 'interrupted' }
    ])
    const tool = lastMessage(state).blocks[0] as ToolBlockView
    expect(tool.status).toBe('error')
  })

  test('a new turn after completion creates a new assistant message', () => {
    const state = run([
      { type: 'text-final', blockId: 'b1', text: 'first' },
      { type: 'turn-complete', stopReason: 'success' },
      { type: 'text-delta', blockId: 'b2', text: 'second' }
    ])
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]!.streaming).toBe(false)
    expect(state.messages[1]!.streaming).toBe(true)
  })
})

describe('errors, limits and session events', () => {
  test('fatal error interrupts the live message and sets the notice', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: 'strea' },
      { type: 'error', code: 'process-crashed', message: 'crashed', fatal: true }
    ])
    expect(state.notice).toEqual({
      code: 'process-crashed',
      message: 'crashed',
      fatal: true
    })
    expect(state.streaming).toBe(false)
    expect(lastMessage(state).interrupted).toBe(true)
  })

  test('non-fatal error only sets a notice', () => {
    const state = run([
      { type: 'text-delta', blockId: 'b1', text: 'ok' },
      { type: 'error', code: 'malformed-output', message: 'bad line', fatal: false }
    ])
    expect(state.notice?.fatal).toBe(false)
    expect(state.streaming).toBe(true)
    expect(clearNotice(state).notice).toBeNull()
  })

  test('limit event sets the banner and input stays usable', () => {
    const state = run([
      {
        type: 'limit',
        limitKind: 'usage',
        resetsAt: '2026-08-05T15:00:00Z',
        message: 'usage limit reached'
      }
    ])
    expect(state.limit).toEqual({
      message: 'usage limit reached',
      resetsAt: '2026-08-05T15:00:00Z'
    })
  })

  test('session-started records the model', () => {
    const state = applyAgentEvent(initialChatViewState, {
      type: 'session-started',
      sessionId: 's1',
      model: 'claude-sonnet-4-5',
      provider: 'claude-code'
    })
    expect(state.model).toBe('claude-sonnet-4-5')
  })

  test('usage event accumulates into sessionUsage (last value wins per turn)', () => {
    const first = applyAgentEvent(initialChatViewState, {
      type: 'usage',
      usage: { inputTokens: 1, outputTokens: 2 }
    })
    expect(first.sessionUsage).toMatchObject({ inputTokens: 1, outputTokens: 2 })

    // 같은 턴의 후속 usage는 누적치 갱신(교체)이지 이중 합산이 아니다.
    const second = applyAgentEvent(first, {
      type: 'usage',
      usage: { inputTokens: 5, outputTokens: 9 }
    })
    expect(second.sessionUsage).toMatchObject({ inputTokens: 5, outputTokens: 9 })
  })
})

describe('local echo', () => {
  test('appendLocalUserMessage appends the user turn and starts streaming', () => {
    const state = appendLocalUserMessage(initialChatViewState, 'u1', '요약해줘')
    expect(state.messages).toHaveLength(1)
    const message = lastMessage(state)
    expect(message.role).toBe('user')
    expect((message.blocks[0] as TextBlockView).text).toBe('요약해줘')
    expect(state.streaming).toBe(true)
  })

  test('sending clears a previous limit banner and notice', () => {
    const limited = run([
      { type: 'limit', limitKind: 'usage', message: 'limited' },
      { type: 'error', code: 'unknown', message: 'x', fatal: false }
    ])
    const state = appendLocalUserMessage(limited, 'u1', 'retry')
    expect(state.limit).toBeNull()
    expect(state.notice).toBeNull()
  })

  test('markSendFailed stops the streaming state', () => {
    const state = markSendFailed(
      appendLocalUserMessage(initialChatViewState, 'u1', 'hi')
    )
    expect(state.streaming).toBe(false)
  })

  test('assistant events after the echo attach to a new assistant message', () => {
    const state = run(
      [{ type: 'text-delta', blockId: 'b1', text: 'reply' }],
      appendLocalUserMessage(initialChatViewState, 'u1', 'question')
    )
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]!.role).toBe('user')
    expect(state.messages[1]!.role).toBe('assistant')
  })
})

describe('seq gap detection', () => {
  test('first batch always applies', () => {
    expect(checkBatchSeq(null, 7)).toBe('apply')
  })

  test('consecutive seq applies', () => {
    expect(checkBatchSeq(7, 8)).toBe('apply')
  })

  test('replayed or old seq is stale', () => {
    expect(checkBatchSeq(8, 8)).toBe('stale')
    expect(checkBatchSeq(8, 3)).toBe('stale')
  })

  test('a jump is a gap → rehydrate via chat:open', () => {
    expect(checkBatchSeq(8, 10)).toBe('gap')
  })
})

describe('hydration from committed history', () => {
  function persisted(
    id: string,
    role: 'user' | 'assistant',
    blocks: Array<{ kind: string; payload: unknown }>
  ): ChatMessage {
    return {
      id,
      courseId: 'c1',
      sessionId: 's1',
      role,
      turnSeq: 1,
      createdAt: '2026-08-05T00:00:00Z',
      blocks: blocks.map((block, index) => ({
        id: `${id}-${index}`,
        messageId: id,
        ord: index,
        kind: block.kind as ChatMessage['blocks'][number]['kind'],
        payload: block.payload
      }))
    }
  }

  test('maps persisted text/thinking/tool/permission payload shapes', () => {
    const history = [
      persisted('m1', 'user', [{ kind: 'text', payload: { text: '질문' } }]),
      persisted('m2', 'assistant', [
        { kind: 'thinking', payload: { text: '생각' } },
        {
          kind: 'tool',
          payload: {
            toolCallId: 'tc1',
            toolName: 'Read',
            label: 'Reading a.pdf',
            input: { file_path: 'a.pdf' },
            ok: true,
            result: { summary: 'Read 10 lines' }
          }
        },
        {
          kind: 'permission',
          payload: {
            requestId: 'req1',
            toolName: 'Write',
            input: { file_path: 'n.md' },
            behavior: 'allow'
          }
        },
        { kind: 'text', payload: { text: '답변' } }
      ])
    ]
    const state = hydrateFromHistory(history, 'claude-sonnet-4-5')
    expect(state.model).toBe('claude-sonnet-4-5')
    expect(state.messages).toHaveLength(2)
    expect(state.streaming).toBe(false)

    const assistant = state.messages[1]!
    expect(assistant.blocks.map((block) => block.kind)).toEqual([
      'thinking',
      'tool',
      'permission',
      'text'
    ])
    const tool = assistant.blocks[1] as ToolBlockView
    expect(tool.status).toBe('ok')
    expect(tool.id).toBe('tc1')
    const permission = assistant.blocks[2] as PermissionBlockView
    expect(permission.behavior).toBe('allow')
    expect(permission.id).toBe('req1')
  })

  test('crash-recovered turn ({text:"", interrupted:true}) marks the message', () => {
    const history = [
      persisted('m1', 'assistant', [
        { kind: 'text', payload: { text: '', interrupted: true } }
      ])
    ]
    const state = hydrateFromHistory(history, null)
    expect(state.messages[0]!.interrupted).toBe(true)
  })

  test('blocks are ordered by ord even when stored out of order', () => {
    const message: ChatMessage = {
      id: 'm1',
      courseId: 'c1',
      sessionId: 's1',
      role: 'assistant',
      turnSeq: 1,
      createdAt: '2026-08-05T00:00:00Z',
      blocks: [
        {
          id: 'b2',
          messageId: 'm1',
          ord: 1,
          kind: 'text',
          payload: { text: 'second' }
        },
        {
          id: 'b1',
          messageId: 'm1',
          ord: 0,
          kind: 'text',
          payload: { text: 'first' }
        }
      ]
    }
    const state = hydrateFromHistory([message], null)
    const texts = state.messages[0]!.blocks.map(
      (block) => (block as TextBlockView).text
    )
    expect(texts).toEqual(['first', 'second'])
  })
})

describe('full synthetic turn (M4-H fixture shape)', () => {
  test('thinking → tool round trip → streamed text → final → complete', () => {
    const events: AgentEvent[] = [
      {
        type: 'session-started',
        sessionId: 'sess',
        model: 'claude-sonnet-4-5',
        provider: 'claude-code'
      },
      { type: 'thinking-delta', blockId: 'msg#0', text: '자료를 확인하자.' },
      { type: 'tool-start', toolCallId: 'toolu_1', toolName: 'Read', label: 'Read' },
      {
        type: 'tool-input-delta',
        toolCallId: 'toolu_1',
        partialInput: '{"file_path":"lec3.pdf"}'
      },
      {
        type: 'tool-start',
        toolCallId: 'toolu_1',
        toolName: 'Read',
        label: 'Reading lec3.pdf',
        input: { file_path: 'lec3.pdf' }
      },
      {
        type: 'tool-end',
        toolCallId: 'toolu_1',
        ok: true,
        result: { summary: 'Read 42 lines' }
      },
      { type: 'text-delta', blockId: 'msg#1', text: '강의는 ' },
      { type: 'text-delta', blockId: 'msg#1', text: '엔트로피를 다룹니다.' },
      { type: 'text-final', blockId: 'msg#1', text: '강의는 엔트로피를 다룹니다.' },
      {
        type: 'turn-complete',
        stopReason: 'success',
        durationMs: 8000,
        costUsd: 0.01
      }
    ]
    const state = run(events, appendLocalUserMessage(initialChatViewState, 'u1', '요약'))
    expect(state.messages).toHaveLength(2)
    const assistant = state.messages[1]!
    expect(assistant.blocks.map((block) => block.kind)).toEqual([
      'thinking',
      'tool',
      'text'
    ])
    const tool = assistant.blocks[1] as ToolBlockView
    expect(tool.status).toBe('ok')
    expect(tool.input).toEqual({ file_path: 'lec3.pdf' })
    const text = assistant.blocks[2] as TextBlockView
    expect(text.text).toBe('강의는 엔트로피를 다룹니다.')
    expect(assistant.streaming).toBe(false)
    expect(state.streaming).toBe(false)
    expect(state.model).toBe('claude-sonnet-4-5')
  })
})
