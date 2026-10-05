import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMcpRegistry, testMcpServer } from '../../../src/main/features/mcpRegistry'
import type { McpServerInput } from '../../../src/shared/types/mcp'

const sdk = vi.hoisted(() => ({
  connect: vi.fn<(transport: unknown) => Promise<void>>(),
  listTools: vi.fn(), close: vi.fn(), stdio: vi.fn(), http: vi.fn()
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect
    listTools = sdk.listTools
    close = sdk.close
  }
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    pid = null
    constructor(public options: unknown) { sdk.stdio(options) }
  }
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, public options: unknown) { sdk.http(url, options) }
  }
}))

const temporaryDirectories: string[] = []
beforeEach(() => {
  sdk.connect.mockReset().mockResolvedValue(undefined)
  sdk.listTools.mockReset().mockResolvedValue({ tools: [{ name: 'search' }] })
  sdk.close.mockReset().mockResolvedValue(undefined)
  sdk.stdio.mockClear()
  sdk.http.mockClear()
})
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function harness() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'bandal-mcp-ipc-'))
  temporaryDirectories.push(userDataPath)
  const registry = createMcpRegistry({
    userDataPath,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value, 'utf8'),
      decryptString: value => value.toString('utf8')
    },
    commandExists: () => true
  })
  const callbacks = new Map<string, (request: unknown) => unknown>()
  const source = readFileSync(join(process.cwd(), 'src/main/ipc/registerHandlers.ts'), 'utf8')
  const start = source.indexOf("  handle('mcp:list'")
  const end = source.indexOf("  handle('chat:deleteConversation'", start)
  if (start < 0 || end < 0) throw new Error('MCP IPC handlers were not found')
  const broadcast = vi.fn()
  // Execute the real registered callbacks with the registry and connection
  // tester; only the SDK transport is replaced so no user server is contacted.
  new Function('handle', 'mcpRegistry', 'testMcpServer', 'broadcast', 'ValidationError', 'OK', source.slice(start, end))(
    (channel: string, callback: (request: unknown) => unknown) => callbacks.set(channel, callback),
    registry, testMcpServer, broadcast, Error, { ok: true }
  )
  const invoke = async (channel: string, request: unknown = {}): Promise<unknown> => {
    const callback = callbacks.get(channel)
    if (!callback) throw new Error(`Missing IPC handler: ${channel}`)
    return callback(request)
  }
  return { registry, invoke, broadcast }
}

describe('MCP authentication across IPC connection tests', () => {
  test('tests disabled HTTP authentication before enabling, without leaking it', async () => {
    const { registry, invoke, broadcast } = harness()
    const input: McpServerInput = {
      name: 'remote', description: '', transport: 'http',
      url: 'https://mcp.example.test/api', enabled: false,
      headers: { Authorization: 'Bearer private-credential' }
    }
    const response = await invoke('mcp:save', input) as { server: { id: string } }
    sdk.connect.mockImplementationOnce(async (transport) => {
      const headers = (transport as { options: { requestInit: { headers: Record<string, string> } } }).options.requestInit.headers
      if (headers.Authorization !== 'Bearer private-credential') throw new Error('Authentication is missing')
    })

    expect(await invoke('mcp:test', { id: response.server.id })).toMatchObject({ ok: true, tools: ['search'] })
    expect(registry.list()[0]).toMatchObject({ enabled: false, lastTest: { ok: true } })
    expect(broadcast).toHaveBeenCalledWith('mcp:changed', {})
    expect(JSON.stringify(response)).not.toContain('private-credential')
    expect(JSON.stringify(await invoke('mcp:list'))).not.toContain('private-credential')

    // Enabling via the secretless summary retains both credentials and success.
    const summary = registry.list()[0]!
    await invoke('mcp:save', { ...summary, enabled: true })
    expect(registry.resolveEnabled()[0]).toMatchObject({
      headers: input.headers, lastTest: { ok: true }
    })
  })

  test('passes a disabled stdio server its saved environment', async () => {
    const { registry, invoke } = harness()
    const saved = registry.save({
      name: 'local', description: '', transport: 'stdio', command: '/usr/bin/env',
      enabled: false, env: { PRIVATE_TOKEN: 'stdio-private-credential' }
    })

    expect(await invoke('mcp:test', { id: saved.id })).toMatchObject({ ok: true })
    expect(sdk.stdio).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ PRIVATE_TOKEN: 'stdio-private-credential' })
    }))
    expect(registry.list()[0]?.enabled).toBe(false)
  })

  test('redacts a disabled server credential from failure IPC and persisted metadata', async () => {
    const { registry, invoke } = harness()
    const saved = registry.save({
      name: 'remote', description: '', transport: 'http',
      url: 'https://mcp.example.test/api', enabled: false,
      headers: { Authorization: 'Bearer sensitive-secret' }
    })
    sdk.connect.mockRejectedValueOnce(new Error('Rejected Bearer sensitive-secret (sensitive-secret)'))

    const result = await invoke('mcp:test', { id: saved.id })
    expect(result).toMatchObject({ ok: false, tools: [], error: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain('sensitive-secret')
    expect(JSON.stringify(await invoke('mcp:list'))).not.toContain('sensitive-secret')
    expect(registry.list()[0]?.lastTest?.ok).toBe(false)
  })

  test.each([
    ['address', { url: 'https://mcp.example.test/changed' }],
    ['authentication', { headers: { Authorization: 'Bearer replacement-secret' } }]
  ] satisfies [string, Partial<McpServerInput>][])(
    'discards a successful probe when its %s changes before completion', async (_field, change) => {
      const { registry, invoke, broadcast } = harness()
      const saved = registry.save({
        name: 'remote', description: '', transport: 'http',
        url: 'https://mcp.example.test/api', enabled: false,
        headers: { Authorization: 'Bearer original-secret' }
      })
      let finishConnection!: () => void
      sdk.connect.mockImplementationOnce(() => new Promise<void>(resolve => { finishConnection = resolve }))

      const pendingResult = invoke('mcp:test', { id: saved.id })
      expect(sdk.connect).toHaveBeenCalledTimes(1)
      expect(sdk.listTools).not.toHaveBeenCalled()
      await invoke('mcp:save', { ...saved, ...change })
      finishConnection()

      const result = await pendingResult
      expect(result).toMatchObject({ ok: false, tools: [], error: expect.stringContaining('설정이 바뀌거나 삭제') })
      expect(registry.list()[0]).toMatchObject({ enabled: false })
      expect(registry.list()[0]?.lastTest).toBeUndefined()
      expect(broadcast).toHaveBeenCalledTimes(1) // Only the actual settings change.
      const publicState = JSON.stringify([result, await invoke('mcp:list')])
      expect(publicState).not.toContain('original-secret')
      expect(publicState).not.toContain('replacement-secret')
    }
  )

  test('discards a probe after deletion and does not mark a replacement registration successful', async () => {
    const { registry, invoke, broadcast } = harness()
    const input: McpServerInput = {
      name: 'remote', description: '', transport: 'http',
      url: 'https://mcp.example.test/api', enabled: false,
      headers: { Authorization: 'Bearer removed-secret' }
    }
    const saved = registry.save(input)
    let finishConnection!: () => void
    sdk.connect.mockImplementationOnce(() => new Promise<void>(resolve => { finishConnection = resolve }))

    const pendingResult = invoke('mcp:test', { id: saved.id })
    expect(sdk.connect).toHaveBeenCalledTimes(1)
    await invoke('mcp:delete', { id: saved.id })
    const replacement = registry.save(input)
    finishConnection()

    const result = await pendingResult
    expect(result).toMatchObject({ ok: false, tools: [], error: expect.stringContaining('설정이 바뀌거나 삭제') })
    expect(registry.resolve(saved.id)).toBeUndefined()
    expect(registry.list()[0]).toMatchObject({ id: replacement.id, enabled: false })
    expect(registry.list()[0]?.lastTest).toBeUndefined()
    expect(broadcast).toHaveBeenCalledTimes(1) // Only deletion; the old result is not published.
    expect(JSON.stringify([result, await invoke('mcp:list')])).not.toContain('removed-secret')
  })

  test('rejects a missing server without attempting a connection', async () => {
    const { invoke } = harness()
    await expect(invoke('mcp:test', { id: 'missing' })).rejects.toThrow('테스트할 MCP 서버를 찾을 수 없습니다.')
    expect(sdk.connect).not.toHaveBeenCalled()
  })
})
