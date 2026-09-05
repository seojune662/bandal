import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createGeminiApiKeyStore } from '../../../src/main/features/agent/geminiApiKeyStore'
import type { SafeStorageLike } from '../../../src/main/lib/safeStorageGate'
import { createTestDb, type TestDb } from '../helpers/testDb'

function xor(bytes: Buffer): Buffer {
  return Buffer.from(bytes.map((byte) => byte ^ 0xa5))
}

function safeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => xor(Buffer.from(plainText, 'utf8')),
    decryptString: (encrypted) => xor(encrypted).toString('utf8')
  }
}

describe('Gemini API key store', () => {
  let ctx: TestDb

  afterEach(() => ctx?.cleanup())

  test('encrypts, hints, reloads, and removes the key', () => {
    ctx = createTestDb()
    const key = 'gemini-test-key-1234567890'
    const storage = safeStorage()
    const store = createGeminiApiKeyStore(ctx.dir, storage)
    const file = join(ctx.dir, 'gemini-api-key.enc')

    expect(store.get()).toEqual({
      configured: false,
      hint: null,
      storageAvailable: true
    })
    expect(store.set(`  ${key}  `)).toEqual({
      configured: true,
      hint: '7890'
    })
    expect(readFileSync(file, 'utf8')).not.toContain(key)
    expect(createGeminiApiKeyStore(ctx.dir, storage).readKey()).toBe(key)

    expect(store.set(null)).toEqual({ configured: false, hint: null })
    expect(existsSync(file)).toBe(false)
  })

  test('rejects short keys and unavailable secure storage', () => {
    ctx = createTestDb()
    expect(() => createGeminiApiKeyStore(ctx.dir, safeStorage()).set('short'))
      .toThrow('키가 너무 짧아요')

    const unavailable = createGeminiApiKeyStore(ctx.dir, safeStorage(false))
    expect(unavailable.get()).toEqual({
      configured: false,
      hint: null,
      storageAvailable: false
    })
    expect(() => unavailable.set('gemini-test-key-1234567890'))
      .toThrow('이 기기에서는 안전 저장소를 쓸 수 없어요')
  })
})
