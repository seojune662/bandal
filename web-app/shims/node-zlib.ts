/**
 * `node:zlib` for the browser build of the sync reader. `format.ts` unzips ink
 * files synchronously, but the browser's DecompressionStream is async. So the
 * reader unzips every ink file first (`prepareGunzip`) and this shim returns
 * that result. A file that failed to unzip throws here, so `format.ts` rejects
 * it whole exactly as the desktop does.
 *
 * Spec 원격 입력 검증 (v2.2) asks for what Node's gunzip does:
 * - Read consecutive gzip members as one.
 * - Accept trailing zero bytes.
 * - Reject any other trailing bytes.
 * DecompressionStream reads one member and fails on anything after it. So when
 * the whole file fails, this finds the member boundaries: a gzip member is
 * self-delimiting, so exactly one candidate end decodes cleanly.
 */
const MAX_OUTPUT = 64 * 1024 * 1024
const unzipped = new WeakMap<Uint8Array, Uint8Array | Error>()

async function gunzipOne(bytes: Uint8Array, budget: number): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader(), parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > budget) {
      await reader.cancel().catch(() => {})
      throw new Error('ink file is over its size limit')
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.byteLength }
  return out
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.byteLength }
  return out
}

async function gunzipMembers(bytes: Uint8Array): Promise<Uint8Array> {
  let end = bytes.byteLength
  while (end > 0 && bytes[end - 1] === 0) end--
  const parts: Uint8Array[] = []
  let start = 0, total = 0
  while (start < end) {
    if (bytes[start] !== 0x1f || bytes[start + 1] !== 0x8b) throw new Error('trailing bytes after gzip data')
    // A member ends at the start of the next one, or among the last zero bytes (its trailer may itself end in zeros).
    const candidates: number[] = []
    for (let at = start + 18; at < end; at++) if (bytes[at] === 0x1f && bytes[at + 1] === 0x8b) candidates.push(at)
    for (let at = end; at <= Math.min(bytes.byteLength, end + 8); at++) candidates.push(at)
    let found = -1
    for (const at of candidates) {
      try {
        const out = await gunzipOne(bytes.subarray(start, at), MAX_OUTPUT - total)
        parts.push(out); total += out.byteLength; found = at
        break
      } catch (error) {
        if ((error as Error).message === 'ink file is over its size limit') throw error
      }
    }
    if (found < 0) throw new Error('invalid gzip data')
    start = found
  }
  return concat(parts)
}

export async function prepareGunzip(bytes: Uint8Array): Promise<void> {
  try {
    unzipped.set(bytes, await gunzipOne(bytes, MAX_OUTPUT))
  } catch (first) {
    if ((first as Error).message === 'ink file is over its size limit') { unzipped.set(bytes, first as Error); return }
    try {
      unzipped.set(bytes, await gunzipMembers(bytes))
    } catch (error) {
      unzipped.set(bytes, error instanceof Error ? error : new Error(String(error)))
    }
  }
}

export function gunzipSync(bytes: Uint8Array): Uint8Array {
  const result = unzipped.get(bytes)
  if (result === undefined) throw new Error('gzip was not prepared for these bytes')
  if (result instanceof Error) throw result
  return result
}
