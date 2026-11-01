/**
 * This device in a sync root (design 2.6): its device_id, the one seq counter
 * every file kind shares, and the machine fingerprint that retires an id
 * copied onto another computer by a backup restore or Migration Assistant.
 */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { writeFileAtomic } from '../../lib/atomicWrite'
import { placeholderTarget } from './format'

export interface SyncIdentity {
  device_id: string
  /** SHA-256 of the machine id the device_id was made on. */
  machine: string
  next_seq: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export function readState(file: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Updates some keys of the state file and keeps the rest: identity here, the binding and device name elsewhere. */
export function patchState(file: string, patch: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileAtomic(file, JSON.stringify({ ...readState(file), ...patch }, null, 2), { mode: 0o600 })
}

const saveState = (file: string, identity: SyncIdentity): void => patchState(file, { ...identity })

/** A missing or unreadable state file, or one made on another machine, starts a new device (M25). */
export function loadIdentity(file: string, machine: string): SyncIdentity {
  const { device_id, machine: madeOn, next_seq } = readState(file)
  if (typeof device_id === 'string' && UUID.test(device_id) && madeOn === machine && Number.isSafeInteger(next_seq) && (next_seq as number) >= 1) {
    return { device_id, machine, next_seq: next_seq as number }
  }
  const identity = { device_id: randomUUID(), machine, next_seq: 1 }
  saveState(file, identity)
  return identity
}

/**
 * Takes the seq for the next file this device writes, saved before the write.
 * It is at least one past the highest seq the root already holds for this
 * device, so a lost state file never overwrites its own files (M24).
 */
export function takeSeq(file: string, identity: Omit<SyncIdentity, 'next_seq'>, rootPaths: Iterable<string>): number {
  const stored = readState(file).next_seq
  const next = Number.isSafeInteger(stored) && (stored as number) >= 1 ? stored as number : 1
  const seq = Math.max(next, ownMaxSeq(rootPaths, identity.device_id) + 1)
  saveState(file, { ...identity, next_seq: seq + 1 })
  return seq
}

/** Highest seq in this device's log, ink and note file names, iCloud placeholders included; 0 when it has none. */
export function ownMaxSeq(paths: Iterable<string>, deviceId: string): number {
  const own = new RegExp(`^(?:log/${deviceId}/(\\d{8})\\.json|ink/[^/]+/\\d+/${deviceId}-(\\d{8})\\.json\\.gz|notes/[^/]+/${deviceId}-(\\d{8})\\.md)$`)
  let max = 0
  for (const path of paths) {
    const match = own.exec(placeholderTarget(path) ?? path)
    if (match) max = Math.max(max, Number(match[1] ?? match[2] ?? match[3]))
  }
  return max
}

const run = promisify(execFile)

/** SHA-256 of IOPlatformUUID (macOS), MachineGuid (Windows) or /etc/machine-id. Throws when none can be read. */
export async function machineFingerprint(): Promise<string> {
  let id: string | undefined
  if (process.platform === 'darwin') {
    const { stdout } = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    id = /"IOPlatformUUID" = "([^"]+)"/.exec(stdout)?.[1]
  } else if (process.platform === 'win32') {
    const { stdout } = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
    id = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(stdout)?.[1]
  } else {
    id = readFileSync('/etc/machine-id', 'utf8').trim() || undefined
  }
  if (id === undefined) throw new Error('machine id is unavailable')
  return sha256(id)
}
