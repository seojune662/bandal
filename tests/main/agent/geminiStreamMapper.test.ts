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

  test('replaces the Workspace eligibility stack with an account action', () => {
    const captured = [
      'Warning: 256-color support not detected',
      'IneligibleTierError: Your current account is not eligible for Gemini Code Assist for individuals',
      'reasonCode: RESTRICTED_DASHER_USER',
      'at authenticate (file:///opt/gemini/auth.js:10:2)',
      'Ripgrep is not available on PATH'
    ].join('\n')

    expect(mapGeminiProcessFailure(1, captured)).toEqual([{
      type: 'error',
      code: 'not-logged-in',
      message: '이 구글 계정은 무료 Gemini를 쓸 수 없어요(학교·회사 계정). 개인 Gmail 계정으로 로그인하거나 설정 > AI 엔진에서 Gemini API 키를 넣어 주세요.',
      fatal: true
    }])
  })

  test('shows only two useful stderr lines', () => {
    const captured = [
      'Warning: 256-color support not detected',
      '첫 오류 줄',
      'at run (file:///opt/gemini/index.js:1:1)',
      'Ripgrep is not available; falling back',
      '둘째 오류 줄',
      '셋째 오류 줄'
    ].join('\n')

    expect(mapGeminiProcessFailure(1, captured)).toEqual([{
      type: 'error',
      code: 'process-crashed',
      message: '첫 오류 줄\n둘째 오류 줄',
      fatal: true
    }])
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
