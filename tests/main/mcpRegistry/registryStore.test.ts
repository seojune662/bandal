import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { McpServerInput } from '../../../src/shared/types/mcp'
import {
  createMcpRegistry,
  MCP_REGISTRY_FILE_NAME,
  type McpRegistryDeps
} from '../../../src/main/features/mcpRegistry'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-mcp-registry-'))
  temporaryDirectories.push(directory)
  return directory
}

function fakeSafeStorage(
  available = true
): McpRegistryDeps['safeStorage'] {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) =>
      Buffer.from(Buffer.from(plainText, 'utf8').toString('base64'), 'utf8'),
    decryptString: (encrypted) =>
      Buffer.from(encrypted.toString('utf8'), 'base64').toString('utf8')
  }
}

function stdioInput(
  name: string,
  overrides: Partial<McpServerInput> = {}
): McpServerInput {
  return {
    name,
    description: `${name} 설명`,
    transport: 'stdio',
    command: '/usr/bin/env',
    args: ['node'],
    env: { PRIVATE_TOKEN: `${name}-secret` },
    enabled: true,
    ...overrides
  }
}

function registry(
  userDataPath = temporaryUserData(),
  overrides: Partial<McpRegistryDeps> = {}
) {
  return createMcpRegistry({
    userDataPath,
    safeStorage: fakeSafeStorage(),
    now: () => new Date('2026-08-21T01:02:03.000Z'),
    commandExists: () => true,
    ...overrides
  })
}

describe('MCP registry persistence', () => {
  test('saves, lists, resolves enabled servers, and deletes them', () => {
    const userDataPath = temporaryUserData()
    const store = registry(userDataPath)
    const saved = store.save(stdioInput('notes'))
    store.save(stdioInput('disabled', { enabled: false }))

    expect(saved).toMatchObject({
      name: 'notes',
      envKeys: ['PRIVATE_TOKEN'],
      headerKeys: []
    })
    expect(saved).not.toHaveProperty('env')
    expect(store.list().map((server) => server.name)).toEqual([
      'disabled',
      'notes'
    ])
    expect(store.resolveEnabled()).toEqual([
      expect.objectContaining({
        name: 'notes',
        env: { PRIVATE_TOKEN: 'notes-secret' }
      })
    ])

    store.delete(saved.id)
    expect(store.list().map((server) => server.name)).toEqual(['disabled'])
    store.delete(store.list()[0]?.id ?? '')
    expect(store.list()).toEqual([])
    expect(existsSync(join(userDataPath, MCP_REGISTRY_FILE_NAME))).toBe(false)
  })

  test('writes an encrypted 0600 envelope without plaintext secrets', () => {
    const userDataPath = temporaryUserData()
    registry(userDataPath).save(stdioInput('private'))
    const path = join(userDataPath, MCP_REGISTRY_FILE_NAME)
    const bytes = readFileSync(path)

    expect(bytes.toString('utf8')).not.toContain('private-secret')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  test('records the latest redacted connection result metadata', () => {
    const store = registry()
    const saved = store.save(stdioInput('tested'))

    store.recordTest(saved.id, {
      ok: true,
      tools: ['search', 'read'],
      durationMs: 12
    })

    expect(store.list()[0]?.lastTest).toEqual({
      at: '2026-08-21T01:02:03.000Z',
      ok: true,
      tools: ['search', 'read']
    })
  })
})

describe('MCP registry validation', () => {
  test.each([
    ['Notion', /소문자/u],
    ['bandal', /예약/u],
    ['a'.repeat(33), /32자/u]
  ])('rejects invalid or reserved name %s', (name, message) => {
    expect(() => registry().save(stdioInput(name))).toThrow(message)
  })

  test('requires an existing executable for stdio servers', () => {
    const commandExists = vi.fn(() => false)
    const store = registry(temporaryUserData(), { commandExists })

    expect(() =>
      store.save(stdioInput('missing', { command: undefined }))
    ).toThrow(/명령어/u)
    expect(() =>
      store.save(stdioInput('unknown', { command: 'does-not-exist' }))
    ).toThrow(/찾을 수 없/u)
    expect(commandExists).toHaveBeenCalledWith('does-not-exist')
  })

  test('accepts only http or https URLs for HTTP servers', () => {
    const store = registry()
    expect(() =>
      store.save({
        name: 'socket',
        description: '',
        transport: 'http',
        url: 'file:///tmp/mcp.sock',
        enabled: true
      })
    ).toThrow(/http:\/\/.*https:\/\//iu)
  })

  test('limits the registry to 20 servers while allowing an update', () => {
    const store = registry()
    for (let index = 0; index < 20; index += 1) {
      store.save(stdioInput(`server-${index}`))
    }
    expect(() => store.save(stdioInput('overflow'))).toThrow(/20개/u)

    const first = store.list()[0]
    expect(first).toBeDefined()
    store.save(stdioInput('renamed', {
      id: first?.id,
      description: '수정됨'
    }))
    expect(store.list()).toHaveLength(20)
  })

  test('keeps existing env and headers when secret fields are omitted', () => {
    const store = registry()
    const saved = store.save({
      name: 'remote',
      description: '처음',
      transport: 'http',
      url: 'https://mcp.example.test/api',
      headers: { Authorization: 'Bearer hidden', 'X-Tenant': 'student' },
      env: { ALSO_PRIVATE: 'keep-me' },
      enabled: true
    })

    store.save({
      id: saved.id,
      name: 'remote',
      description: '수정',
      transport: 'http',
      url: 'https://mcp.example.test/v2',
      enabled: false
    })

    expect(store.list()[0]).toMatchObject({
      envKeys: ['ALSO_PRIVATE'],
      headerKeys: ['Authorization', 'X-Tenant']
    })
    const resolved = store.list()[0]
    expect(resolved).not.toHaveProperty('env')
    expect(resolved).not.toHaveProperty('headers')
  })
})

describe('MCP registry encryption availability', () => {
  test('reports unavailable and returns an empty list without a fallback', () => {
    const userDataPath = temporaryUserData()
    const store = registry(userDataPath, {
      safeStorage: fakeSafeStorage(false)
    })

    expect(store.availability()).toEqual({
      available: false,
      reason: expect.any(String)
    })
    expect(store.list()).toEqual([])
    expect(() => store.save(stdioInput('blocked'))).toThrow(/보안 저장소/u)
    expect(existsSync(join(userDataPath, MCP_REGISTRY_FILE_NAME))).toBe(false)
  })
})
