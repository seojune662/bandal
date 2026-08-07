/**
 * The auth session store must not open the OS keychain at construction.
 *
 * This is the SECOND place that did. The browser cookie store was fixed first
 * and the prompt kept appearing, because `createSessionStore` evaluated
 * `isEncryptionAvailable()` in an IIFE — so simply building the group runtime
 * (which happens at launch, and now also whenever the whiteboard asks for the
 * Supabase client) raised the macOS "반달 wants to use your confidential
 * information" dialog for every student, including one who has never signed in
 * and has nothing to decrypt.
 */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createSessionStore } from '../../../src/main/features/group/sessionStore'

/** Counts keychain touches; each one can raise the password dialog. */
function countingEncryptor(available = true): {
  touches: () => number
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
} {
  let touches = 0
  return {
    touches: () => touches,
    isEncryptionAvailable: () => {
      touches += 1
      return available
    },
    encryptString: (plainText) => {
      touches += 1
      return Buffer.from(plainText, 'utf8')
    },
    decryptString: (encrypted) => {
      touches += 1
      return encrypted.toString('utf8')
    }
  }
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'bandal-session-')), 'session.enc')
}

describe('group auth session store — keychain access', () => {
  test('constructing it touches the keychain zero times', () => {
    const encryptor = countingEncryptor()
    createSessionStore({ filePath: tempFile(), encryptor })

    expect(encryptor.touches()).toBe(0)
  })

  test('reading with no session file on disk stays silent', async () => {
    const encryptor = countingEncryptor()
    const store = createSessionStore({ filePath: tempFile(), encryptor })

    await expect(store.getItem('token')).resolves.toBeNull()
    // Nothing to decrypt — asking the student for a keychain password to
    // discover that is pure cost.
    expect(encryptor.touches()).toBe(0)
  })

  test('an existing session file IS decrypted', async () => {
    const encryptor = countingEncryptor()
    const filePath = tempFile()
    writeFileSync(filePath, Buffer.from(JSON.stringify({ token: 'abc' }), 'utf8'))
    const store = createSessionStore({ filePath, encryptor })

    await expect(store.getItem('token')).resolves.toBe('abc')
    expect(encryptor.touches()).toBeGreaterThan(0)
  })

  test('signing in persists and does touch the keychain', async () => {
    const encryptor = countingEncryptor()
    const store = createSessionStore({ filePath: tempFile(), encryptor })

    await store.setItem('token', 'abc')

    // Now the prompt is tied to something the student did: they signed in.
    expect(encryptor.touches()).toBeGreaterThan(0)
  })

  test('clearing the last key removes the file rather than writing an empty one', async () => {
    const encryptor = countingEncryptor()
    const filePath = tempFile()
    const store = createSessionStore({ filePath, encryptor })

    await store.setItem('token', 'abc')
    expect(existsSync(filePath)).toBe(true)

    await store.removeItem('token')

    // An empty file would survive to the next launch, where its mere existence
    // reopens the keychain for a payload with nothing in it.
    expect(existsSync(filePath)).toBe(false)
  })

  test('a store that cannot encrypt still works in memory', async () => {
    const encryptor = countingEncryptor(false)
    const store = createSessionStore({ filePath: tempFile(), encryptor })

    await store.setItem('token', 'abc')
    await expect(store.getItem('token')).resolves.toBe('abc')
  })
})
