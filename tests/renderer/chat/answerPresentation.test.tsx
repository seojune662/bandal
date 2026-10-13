import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { MessageList, responseStatus } from '../../../src/renderer/src/features/chat/MessageList'
import { AgentConfirmCard } from '../../../src/renderer/src/features/chat/AgentToolCards'
import type { MessageView } from '../../../src/renderer/src/features/chat/chatModel'

const turn: MessageView = {
  id: 'answer', role: 'assistant', streaming: true, interrupted: false,
  blocks: [
    { kind: 'thinking', id: 'thinking', text: 'private implementation notes', streaming: false },
    { kind: 'tool', id: 'tool', toolName: 'Bash', label: '/bin/zsh -lc cat .bandal/COURSE.md', input: { command: 'cat .bandal/COURSE.md' }, status: 'running' }
  ]
}
const render = (message: MessageView) => renderToStaticMarkup(<MessageList messages={[message]} pendingPermissionId={null} onRespondPermission={() => {}} />)

describe('readable assistant answers', () => {
  test('summarizes running work once without commands or raw reasoning', () => {
    const html = render(turn)
    expect(html).toContain('자료를 살펴보는 중')
    expect(html.match(/class="chat-response-status"/g)).toHaveLength(1)
    for (const technical of ['/bin/zsh', 'COURSE.md', 'private implementation', 'chat-tool', 'chat-thinking']) expect(html).not.toContain(technical)
  })

  test('completed answers keep the answer and copy action without execution bookkeeping', () => {
    const html = render({ ...turn, streaming: false, blocks: [...turn.blocks,
      { kind: 'text', id: 'text', text: '질량은 보존됩니다.', streaming: false },
      { kind: 'permission', id: 'approval', toolName: 'Bash', input: {}, behavior: 'allow' }
    ] })
    expect(html).toContain('질량은 보존됩니다.')
    expect(html).toContain('aria-label="답변 복사"')
    expect(html).not.toContain('chat-response-status')
    expect(html).not.toContain('chat-permission')
    expect(html).not.toContain('/bin/zsh')
  })

  test('shows waiting and writing phases without exposing the model reasoning', () => {
    expect(responseStatus()).toBe('생각 중')
    expect(responseStatus({ ...turn, blocks: [{ kind: 'text', id: 'text', text: '질량', streaming: true }] })).toBe('답변 작성 중')
  })

  test('exceptional shell confirmation uses plain language without command details', () => {
    const html = renderToStaticMarkup(<AgentConfirmCard request={{ requestId: 'shell', courseId: 'c', conversationId: 's', tool: 'cli:codex:commandExecution', summary: '명령을 실행할까요?', details: ["/bin/zsh -lc 'cat .bandal/COURSE.md'"] }} response={null} onRespond={() => {}} />)
    expect(html).toContain('요청한 작업을 계속할까요?')
    expect(html).not.toContain('/bin/zsh')
    expect(html).not.toContain('<pre')
  })

  test('restricted file-read requests also keep raw provider JSON out of the fallback', () => {
    const html = renderToStaticMarkup(<AgentConfirmCard request={{ requestId: 'read', courseId: 'c', conversationId: 's', tool: 'cli:Read', summary: 'Read', details: ['{"file_path":"/private/skill/SKILL.md"}'] }} response={null} onRespond={() => {}} />)
    expect(html).toContain('자료를 확인하고 이어갈까요?')
    expect(html).not.toContain('file_path')
    expect(html).not.toContain('SKILL.md')
  })
})
