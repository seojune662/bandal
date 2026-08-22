import { randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function writeFileAtomic(
  absPath: string,
  data: string | Buffer,
  opts?: { mode?: number }
): void {
  const temporaryPath = join(
    dirname(absPath),
    `.${basename(absPath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  )
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  let descriptor: number | undefined

  try {
    descriptor = openSync(temporaryPath, 'wx', opts?.mode ?? 0o666)
    let offset = 0
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset)
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, absPath)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // Preserve the original atomic-write error.
      }
    }
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Preserve the original atomic-write error.
    }
    throw error
  }
}

export function quarantineFile(absPath: string, now = new Date()): string | null {
  if (!existsSync(absPath)) return null

  const basePath = `${absPath}.corrupt-${now.toISOString()}`
  let quarantinePath = basePath
  let suffix = 1
  while (existsSync(quarantinePath)) {
    quarantinePath = `${basePath}-${suffix}`
    suffix += 1
  }
  renameSync(absPath, quarantinePath)
  return quarantinePath
}
