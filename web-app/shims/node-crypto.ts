/**
 * `node:crypto` for the browser build of the sync reader. `format.ts` hashes
 * note snapshots synchronously; WebCrypto is async, so the reader hashes every
 * note first (`prepareDigests`) and this shim only looks the digest up. A
 * missing digest is a programming error, never a silent wrong hash.
 */
const digests = new WeakMap<Uint8Array, string>()

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

export async function prepareDigest(bytes: Uint8Array): Promise<void> {
  digests.set(bytes, hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)))
}

export function createHash(algorithm: string): { update(bytes: Uint8Array): { digest(encoding: 'hex'): string } } {
  if (algorithm !== 'sha256') throw new Error(`${algorithm} is not available in the browser reader`)
  return {
    update(bytes) {
      return {
        digest() {
          const known = digests.get(bytes)
          if (known === undefined) throw new Error('sha256 was not prepared for these bytes')
          return known
        }
      }
    }
  }
}

export function randomUUID(): string {
  return crypto.randomUUID()
}
