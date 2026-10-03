import { createServer, request } from 'node:http'
import { createConnection, createServer as createTcpServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createPinnedArticleProxy } from '../../../src/main/features/learning/articleNetwork'

const publicAnswer = [{ address: '93.184.216.34' }]
describe('pinned article network boundary', () => {
  const cleanup: Array<() => Promise<void>> = []
  afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
  async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    return (server.address() as { port: number }).port
  }
  function port(rules: string): number { return Number(rules.match(/http=127\.0\.0\.1:(\d+)/u)![1]) }
  function fetch(proxyPort: number, url: string, headers = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port: proxyPort, path: url, headers, agent: false }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', text => { body += text })
        response.on('end', () => resolve({ status: response.statusCode!, body })); response.on('error', reject)
      })
      outgoing.on('error', reject); outgoing.end()
    })
  }
  function tunnel(proxyPort: number, authority: string): Promise<{ status: number; socket: Socket }> {
    return new Promise((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: authority, agent: false })
      outgoing.on('connect', (response, socket) => resolve({ status: response.statusCode!, socket }))
      outgoing.on('error', reject); outgoing.end()
    })
  }

  test('pins HTTP to the checked numeric IP and denies a later private DNS answer for the same host', async () => {
    const sourcePort = await listen(createServer((incoming, response) => response.end(`original:${incoming.headers.host}:${incoming.url}`)))
    const connect = vi.fn((target: { host: string; port: number }) => { expect(target).toEqual({ host: '93.184.216.34', port: 80 }); return createConnection({ host: '127.0.0.1', port: sourcePort }) })
    const resolver = vi.fn().mockResolvedValueOnce(publicAnswer).mockResolvedValue([{ address: '127.0.0.1' }])
    const proxy = await createPinnedArticleProxy({ resolveHost: resolver, connect }); cleanup.push(() => proxy.close())
    expect(await fetch(port(proxy.proxyRules), 'http://news.example.org/story')).toEqual({ status: 200, body: 'original:news.example.org:/story' })
    expect(await fetch(port(proxy.proxyRules), 'http://news.example.org/private')).toEqual({ status: 403, body: '' })
    expect(connect).toHaveBeenCalledOnce()
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  test('pins HTTPS CONNECT before relaying opaque TLS bytes and closes active tunnels', async () => {
    const sourcePort = await listen(createTcpServer(socket => socket.on('data', bytes => socket.write(bytes))))
    const connect = vi.fn((target: { host: string; port: number }) => { expect(target).toEqual({ host: '93.184.216.34', port: 443 }); return createConnection({ host: '127.0.0.1', port: sourcePort }) })
    const proxy = await createPinnedArticleProxy({ resolveHost: async () => publicAnswer, connect }); cleanup.push(() => proxy.close())
    const connected = await tunnel(port(proxy.proxyRules), 'news.example.org:443')
    expect(connected.status).toBe(200)
    const bytes = new Promise<string>(resolve => connected.socket.once('data', chunk => resolve(chunk.toString())))
    connected.socket.write('opaque verified TLS bytes')
    expect(await bytes).toBe('opaque verified TLS bytes')
    const ended = new Promise<void>(resolve => connected.socket.once('close', () => resolve()))
    await proxy.close(); await ended
    expect(connect).toHaveBeenCalledOnce()
    await expect(fetch(port(proxy.proxyRules), 'http://news.example.org/story')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  test('denies credentials, private literals, mixed DNS answers and redirect targets before connecting', async () => {
    const connect = vi.fn(() => { throw new Error('Must not connect') })
    const proxy = await createPinnedArticleProxy({ resolveHost: async () => [...publicAnswer, { address: '192.168.1.1' }], connect }); cleanup.push(() => proxy.close())
    for (const url of ['http://user:password@news.example.org/story', 'http://127.0.0.1/private', 'http://[::1]/private', 'http://news.example.org/story']) {
      expect((await fetch(port(proxy.proxyRules), url)).status).toBe(403)
    }
    expect((await fetch(port(proxy.proxyRules), 'http://news.example.org/story', { Authorization: 'Basic ignored' })).status).toBe(403)
    for (const authority of ['user:password@news.example.org:443', '127.0.0.1:443', 'news.example.org:8080', 'news.example.org:443/path']) {
      const connected = await tunnel(port(proxy.proxyRules), authority)
      expect(connected.status).toBe(403); connected.socket.destroy()
    }
    expect(connect).not.toHaveBeenCalled()
  })

  test('late DNS completion cannot open a connection after the extraction has closed', async () => {
    let finish: (addresses: typeof publicAnswer) => void = () => {}
    let started: () => void = () => {}
    const resolving = new Promise<void>(resolve => { started = resolve })
    const connect = vi.fn(() => { throw new Error('Must not connect') })
    const proxy = await createPinnedArticleProxy({ resolveHost: () => { started(); return new Promise(resolve => { finish = resolve }) }, connect })
    cleanup.push(() => proxy.close())
    const pending = fetch(port(proxy.proxyRules), 'http://news.example.org/story').catch(error => error)
    await resolving; await proxy.close(); finish(publicAnswer); await pending
    await new Promise(resolve => setImmediate(resolve))
    expect(connect).not.toHaveBeenCalled()
  })
})
