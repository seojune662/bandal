// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NativeMailWidget, mailText } from '../../../src/renderer/src/features/widgets/MailWidget'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
vi.mock('../../../src/renderer/src/app/tabCommands', () => ({ createBrowserTab: vi.fn() }))
vi.mock('../../../src/renderer/src/features/browser/webviewPassthrough', () => ({ acquirePointerPassthrough: () => () => {} }))
vi.mock('../../../src/renderer/src/components/useFocusTrap', () => ({ useFocusTrap: () => {} }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const message = { id: '1', threadId: 't1', from: 'Professor <prof@example.edu>', to: 'me@example.edu', subject: '수업 안내', snippet: '강의 공지', date: '2026-09-09T00:00:00Z', unread: true, starred: false, text: '안녕하세요\n강의실이 변경됐어요.', html: '', messageId: 'rfc1', references: '', replyTo: 'prof@example.edu', attachments: [] }
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockImplementation(async (channel) => channel === 'mail:state' ? { status: 'connected', email: 'me@example.edu', experimental: true } : channel === 'mail:list' ? { messages: [message], nextPageToken: null } : channel === 'mail:read' ? message : { ok: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function mount(): Promise<void> { await act(async () => root.render(<NativeMailWidget fallback={null} />)) }
async function click(text: string): Promise<void> {
  const button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes(text))!
  expect(button).toBeDefined()
  await act(async () => button.click())
}

test('native mailbox reads, replies and archives with no embedded website', async () => {
  await mount()
  expect(host.querySelector('webview, iframe')).toBeNull()
  expect(host.textContent).toContain('수업 안내')
  await click('수업 안내')
  expect(host.textContent).toContain('강의실이 변경됐어요.')
  expect(invoke).toHaveBeenCalledWith('mail:modify', { id: '1', action: 'read' })
  const textarea = host.querySelector('textarea')!
  await act(async () => { Simulate.change(textarea, { target: { value: '확인했습니다.' } } as never) })
  await act(async () => Simulate.submit(host.querySelector('.mail-mini__reply')!))
  expect(invoke).toHaveBeenCalledWith('mail:reply', { messageId: '1', text: '확인했습니다.' })
  expect(host.textContent).toContain('답장을 보냈어요.')
  await click('보관')
  expect(invoke).toHaveBeenCalledWith('mail:modify', { id: '1', action: 'archive' })
  expect(host.querySelector('.mail-mini__list')?.textContent).not.toContain('수업 안내')
})

test('a failed read stops the spinner and offers a working retry', async () => {
  const original = invoke.getMockImplementation()!
  let fails = true
  invoke.mockImplementation(async (channel, input) => {
    if (channel === 'mail:read' && fails) throw new Error('네트워크 오류')
    return original(channel, input)
  })
  await mount(); await click('수업 안내')
  expect(host.textContent).not.toContain('메일을 불러오는 중')
  expect(host.textContent).toContain('다시 시도')
  fails = false
  await click('다시 시도')
  expect(host.textContent).toContain('강의실이 변경됐어요.')
})

test('provider HTML never mounts scripts, images, iframes, or decoded tags', () => {
  const value = mailText('', '<head>hidden</head><script>alert(1)</script><p>안녕 &amp; 반달</p><img src="https://tracker.test/pixel"><iframe>hidden</iframe>&lt;img src=x onerror=alert(1)&gt;')
  expect(value).toContain('안녕 & 반달')
  expect(value).not.toContain('hidden')
  expect(value).not.toContain('tracker.test')
  expect(host.querySelector('img,script,iframe')).toBeNull()
})

test('unconfigured builds offer an honest fallback, not a broken login', async () => {
  invoke.mockResolvedValue({ status: 'unconfigured', email: null, experimental: true })
  await mount()
  expect(host.textContent).toContain('연결을 준비하고 있어요')
  expect(host.textContent).toContain('전체 Gmail')
  expect(invoke).not.toHaveBeenCalledWith('mail:list', expect.anything())
})
