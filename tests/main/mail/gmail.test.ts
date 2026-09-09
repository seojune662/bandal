import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { gmailMessage, replyMime } from '../../../src/main/features/mail/gmailModel'
import { createGmailService } from '../../../src/main/features/mail/gmailService'

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().slice(10))
}))
const openExternal = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/lib/safeStorageGate', () => ({ runtimeSafeStorage: () => storage }))
vi.mock('electron', () => ({ shell: { openExternal } }))

const message = {
  id: 'msg1', threadId: 'thread1', labelIds: ['INBOX', 'UNREAD'], internalDate: '1788910000000',
  payload: { headers: [{ name: 'From', value: '교수 <prof@example.edu>' }, { name: 'Subject', value: '강의 안내' }, { name: 'message-id', value: '<original@example.edu>' }],
    parts: [{ mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('안녕하세요\n강의 공지').toString('base64url') } },
      { mimeType: 'text/html', body: { data: Buffer.from('<b>공지</b>').toString('base64url') } }
    ] }, { filename: 'lecture.pdf', body: { attachmentId: 'file1', size: 125 } }] }
}

test('decodes nested Korean MIME, labels, attachments and reply headers without injection', () => {
  const detail = gmailMessage(message)
  expect(detail.text).toBe('안녕하세요\n강의 공지')
  expect(detail.html).toBe('<b>공지</b>')
  expect(detail.attachments).toEqual([{ id: 'file1', name: 'lecture.pdf', size: 125 }])
  expect(detail.unread).toBe(true)
  expect(detail.messageId).toBe('<original@example.edu>')
  const raw = Buffer.from(replyMime({ ...detail, replyTo: 'prof@example.edu\r\nBcc: evil@example.org' }, 'me@example.edu', '감사합니다\n다음 시간에 뵙겠습니다'), 'base64url').toString()
  expect(raw).toContain('In-Reply-To: <original@example.edu>')
  expect(raw).not.toMatch(/\r\nBcc:/)
  expect(Buffer.from(raw.split('\r\n\r\n')[1]!, 'base64').toString()).toBe('감사합니다\r\n다음 시간에 뵙겠습니다')
  expect(() => replyMime(detail, 'me@example.edu', ' ')).toThrow()
  expect(() => replyMime(detail, 'me@example.edu', 'x'.repeat(100001))).toThrow()
})

describe('Gmail desktop session', () => {
  let dir: string
  const originalFetch = globalThis.fetch
  const mockFetch = vi.fn<typeof fetch>()
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bandal-mail-test-'))
    vi.clearAllMocks()
    vi.stubEnv('MAIN_VITE_GMAIL_CLIENT_ID', 'desktop-client.apps.googleusercontent.com')
    vi.stubGlobal('fetch', mockFetch)
  })
  afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }) })
  async function seed(expiresAt = 0): Promise<void> {
    await mkdir(join(dir, 'gmail'))
    await writeFile(join(dir, 'gmail/session.enc'), storage.encryptString(JSON.stringify({ accessToken: 'old', refreshToken: 'refresh', expiresAt, email: 'me@example.edu' })))
  }
  test('does not touch Keychain when no account is connected', async () => {
    expect((await createGmailService(dir).state()).status).toBe('disconnected')
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(storage.decryptString).not.toHaveBeenCalled()
  })
  test('PKCE loopback validates state and only returns account metadata to the renderer', async () => {
    openExternal.mockImplementation(async (value: string) => {
      const auth = new URL(value)
      expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
      expect(auth.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.modify')
      const redirect = new URL(auth.searchParams.get('redirect_uri')!)
      redirect.search = new URLSearchParams({ code: 'test-code', state: 'wrong' }).toString()
      expect((await originalFetch(redirect)).status).toBe(400)
      redirect.searchParams.set('state', auth.searchParams.get('state')!)
      expect((await originalFetch(redirect)).status).toBe(200)
    })
    mockFetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/token')) {
        expect((init?.body as URLSearchParams).get('code_verifier')?.length).toBeGreaterThan(40)
        return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 })
      }
      return Response.json({ emailAddress: 'me@example.edu' })
    })
    const state = await createGmailService(dir).connect()
    expect(state).toEqual({ status: 'connected', email: 'me@example.edu', experimental: true })
    expect((await readFile(join(dir, 'gmail/session.enc'), 'utf8')).startsWith('encrypted:')).toBe(true)
  })
  test('shares one refresh for parallel requests and reads real labels', async () => {
    await seed()
    mockFetch.mockImplementation(async (url) => String(url).endsWith('/token') ? Response.json({ access_token: 'new', expires_in: 3600 }) : Response.json(message))
    const service = createGmailService(dir)
    const results = await Promise.all([service.read('msg1'), service.read('msg2')])
    expect(results[0]?.unread).toBe(true)
    expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1)
    await expect(service.read('../profile')).rejects.toThrow('식별자')
  })
  test('an in-flight refresh cannot resurrect credentials after disconnect', async () => {
    await seed()
    let release!: (response: Response) => void
    mockFetch.mockImplementation(async (url) => String(url).endsWith('/token') ? new Promise<Response>((resolve) => { release = resolve }) : Response.json({}))
    const service = createGmailService(dir)
    const request = service.read('msg1')
    const rejected = expect(request).rejects.toThrow('연결이 변경')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await service.disconnect()
    release(Response.json({ access_token: 'late', expires_in: 3600 }))
    await rejected
    expect((await service.state()).status).toBe('disconnected')
    await expect(readFile(join(dir, 'gmail/session.enc'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  test('revoked refresh tokens require explicit reconnection', async () => {
    await seed()
    mockFetch.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    const service = createGmailService(dir)
    await expect(service.read('msg1')).rejects.toThrow('만료')
    expect((await service.state()).status).toBe('reauth-required')
  })
})
