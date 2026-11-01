/**
 * Google sign-in for the desktop app, shared by Gmail and Drive sync (design
 * 2.5): the system browser, a one-off loopback server on 127.0.0.1 that takes
 * the redirect (checked by state), PKCE (S256), and the token endpoint with
 * the Desktop client's secret.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell } from 'electron'

export interface GoogleTokens { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }

/** The Desktop client both features use (MAIN_VITE_GMAIL_CLIENT_ID); '' when this build has none. */
export function googleClient(): { clientId: string; clientSecret: string } {
  const env = import.meta.env as Record<string, string | undefined>
  const value = (key: string): string => process.env[key] ?? env[key] ?? ''
  // Google requires the Desktop client secret even with PKCE; it is not confidential for installed apps.
  return { clientId: value('MAIN_VITE_GMAIL_CLIENT_ID'), clientSecret: value('MAIN_VITE_GOOGLE_DESKTOP_CLIENT_SECRET') }
}

/** A grant at the token endpoint, as this client. */
export async function tokenRequest(body: URLSearchParams): Promise<{ ok: boolean; result: GoogleTokens }> {
  const { clientId, clientSecret } = googleClient()
  body.set('client_id', clientId)
  if (clientSecret) body.set('client_secret', clientSecret)
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
  return { ok: response.ok, result: await response.json() as GoogleTokens }
}

export const revokeToken = (token: string): Promise<unknown> =>
  fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) }).catch(() => {})

/**
 * Asks for `scope` in the browser and waits for the redirect; resolves with the
 * authorization-code grant for `tokenRequest`. `label` names the connection on
 * the page the browser shows and in errors ("메일", "Google Drive").
 */
export async function authorize(options: { scope: string; label: string; signal: AbortSignal }): Promise<URLSearchParams> {
  const { scope, label, signal } = options
  const verifier = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url')
  const server = createServer()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('인증 창을 열지 못했어요.')
    const redirect = `http://127.0.0.1:${address.port}/oauth/callback`
    const codePromise = new Promise<string>((resolve, reject) => {
      const cancel = () => reject(new Error(`${label} 연결을 취소했어요.`))
      if (signal.aborted) cancel()
      signal.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => reject(new Error(`${label} 연결 시간이 지났어요. 다시 시도해 주세요.`)), 180_000)
      server.on('request', (request, response) => {
        // Anything on this machine can call the port: a malformed request is turned away, never thrown.
        let url: URL
        try {
          url = new URL(request.url ?? '/', redirect)
        } catch {
          response.writeHead(400).end()
          return
        }
        if (request.method !== 'GET' || url.pathname !== '/oauth/callback' || url.searchParams.get('state') !== nonce) { response.writeHead(400).end(); return }
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        const code = url.searchParams.get('code')
        if (url.searchParams.has('error') || !code) { response.end(`${label} 연결을 취소했어요. Bandal로 돌아가 주세요.`); cancel(); return }
        response.end(`Bandal에서 ${label} 연결을 마무리하고 있어요. 앱으로 돌아가 주세요.`)
        resolve(code)
      })
    })
    // Attach a rejection handler before opening the browser (which can itself fail).
    void codePromise.catch(() => {})
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({ client_id: googleClient().clientId, redirect_uri: redirect, response_type: 'code', scope, state: nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' }).toString()
    if (signal.aborted) throw new Error(`${label} 연결을 취소했어요.`)
    await shell.openExternal(url.href)
    return new URLSearchParams({ code: await codePromise, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' })
  } finally { if (timer) clearTimeout(timer); server.closeAllConnections(); server.close() }
}

/** Whether Google granted `scope`: a person can untick it on the consent screen. */
export const granted = (result: GoogleTokens, scope: string): boolean => !result.scope || result.scope.split(' ').includes(scope)
