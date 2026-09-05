import { describe, expect, test } from 'vitest'
import {
  createGeminiStreamMapper,
  mapGeminiProcessFailure
} from '../../../src/main/features/agent/gemini/streamMapper'

describe('Gemini stream-json mapper', () => {
  test('maps init, deltas, tools and terminal usage', () => {
    const mapper = createGeminiStreamMapper()
    mapper.beginTurn()
    const events = [
      { type: 'init', session_id: 'gemini-session', model: 'flash' },
      { type: 'message', role: 'assistant', content: '안녕', delta: true },
      {
        type: 'tool_use',
        tool_name: 'read_file',
        tool_id: 'tool-1',
        parameters: { path: 'notes.md' }
      },
      {
        type: 'tool_result',
        tool_id: 'tool-1',
        status: 'success',
        output: 'read 10 lines'
      },
      {
        type: 'result',
        status: 'success',
        stats: {
          input_tokens: 7,
          output_tokens: 3,
          cached: 2,
          duration_ms: 125
        }
      }
    ].flatMap((event) => mapper.map(event))

    expect(events[0]).toEqual({
      type: 'session-started',
      sessionId: 'gemini-session',
      model: 'flash',
      provider: 'gemini'
    })
    expect(events).toContainEqual({
      type: 'text-delta',
      blockId: 'gemini-assistant-1',
      text: '안녕'
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-start',
        toolCallId: 'tool-1',
        toolName: 'read_file'
      })
    )
    expect(events.at(-1)).toEqual({
      type: 'turn-complete',
      stopReason: 'success',
      usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2 },
      durationMs: 125
    })
  })

  test('maps the unauthenticated 0.58.0 smoke capture to not-logged-in', () => {
    const captured =
      'Please set an Auth method in your /tmp/gemini/.gemini/settings.json or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA'
    expect(mapGeminiProcessFailure(41, captured)).toEqual([
      {
        type: 'error',
        code: 'not-logged-in',
        message: 'Gemini에 로그인이 필요해요.',
        fatal: true
      }
    ])
  })

  test('surfaces exit 53 as a completed max-turns turn', () => {
    expect(mapGeminiProcessFailure(53, '')).toEqual([
      {
        type: 'error',
        code: 'unknown',
        message: '턴 한도에 도달했어요.',
        fatal: false
      },
      { type: 'turn-complete', stopReason: 'max-turns' }
    ])
  })
})
