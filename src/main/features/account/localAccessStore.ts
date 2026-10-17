import { existsSync, mkdirSync, readFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LocalAccessState } from '../../../shared/types/auth'

interface Receipt { version: 1; profileID: string; boundUserID: string | null; verifiedAt: string | null; locked: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const invalidReceipt = (): Error => new Error('로컬 계정 연결 기록을 확인할 수 없습니다. 백업 후 복구해 주세요.')

function validReceipt(value: unknown): value is Receipt {
  if (typeof value !== 'object' || value === null) return false
  const saved = value as Partial<Receipt>
  const validDate = typeof saved.verifiedAt === 'string' && Number.isFinite(Date.parse(saved.verifiedAt)) &&
    new Date(saved.verifiedAt).toISOString() === saved.verifiedAt
  return saved.version === 1 && typeof saved.profileID === 'string' && uuid.test(saved.profileID) &&
    (saved.boundUserID === null || (typeof saved.boundUserID === 'string' && uuid.test(saved.boundUserID))) &&
    typeof saved.locked === 'boolean' && (saved.verifiedAt === null || validDate) &&
    (saved.verifiedAt === null || saved.boundUserID !== null) &&
    (saved.locked || (saved.boundUserID !== null && validDate))
}
export interface LocalAccessStore {
  state(): LocalAccessState
  acceptVerified(userID: string): void
  canAccept(userID: string): boolean
  confirm(userID: string): void
  lock(): void
  requiresInteractiveSignIn(): boolean
  beginDeletion(): { cancel(): void }
}

export function createLocalAccessStore(root: string): LocalAccessStore {
  const file = join(root, 'profile-access.json')
  let receipt: Receipt = { version: 1, profileID: randomUUID(), boundUserID: null, verifiedAt: null, locked: true }
  if (existsSync(file)) {
    // Fail closed on corruption; never silently rebind another account.
    let saved: unknown
    try { saved = JSON.parse(readFileSync(file, 'utf8')) } catch { throw invalidReceipt() }
    if (!validReceipt(saved)) throw invalidReceipt()
    receipt = saved
  } else {
    const legacy = join(root, 'ipad-companion', 'preferences.json')
    if (existsSync(legacy)) {
      const saved = JSON.parse(readFileSync(legacy, 'utf8')) as { boundUserID?: unknown }
      if (saved.boundUserID !== undefined && saved.boundUserID !== null) {
        if (typeof saved.boundUserID !== 'string' || !uuid.test(saved.boundUserID)) throw invalidReceipt()
        receipt.boundUserID = saved.boundUserID
      }
    }
  }
  let pending: string | null = null
  const save = (next: Receipt): void => {
    mkdirSync(root, { recursive: true })
    const descriptor = openSync(`${file}.tmp`, 'w', 0o600)
    try { writeSync(descriptor, JSON.stringify(next)); fsyncSync(descriptor) } finally { closeSync(descriptor) }
    renameSync(`${file}.tmp`, file)
    // Publish access only after the durable receipt was replaced successfully.
    receipt = next
  }
  save(receipt)
  return {
    state: () => ({ allowed: receipt.verifiedAt !== null && !receipt.locked, requiresLogin: receipt.verifiedAt === null || receipt.locked,
      boundUserID: receipt.boundUserID, profileID: receipt.profileID, requiresBindingConfirmation: pending !== null && receipt.boundUserID === null, pendingUserID: pending }),
    canAccept: userID => receipt.boundUserID === null || receipt.boundUserID === userID,
    requiresInteractiveSignIn: () => receipt.locked && receipt.verifiedAt !== null,
    acceptVerified(userID) {
      if (!uuid.test(userID)) throw invalidReceipt()
      if (receipt.boundUserID !== null && receipt.boundUserID !== userID) throw new Error('profile-mismatch')
      if (receipt.boundUserID === null) { pending = userID; return }
      save({ ...receipt, verifiedAt: new Date().toISOString(), locked: false })
    },
    confirm(userID) {
      if (pending !== userID || receipt.boundUserID !== null) throw new Error('profile-confirmation-expired')
      save({ ...receipt, boundUserID: userID, verifiedAt: new Date().toISOString(), locked: false }); pending = null
    },
    lock() { save({ ...receipt, locked: true }); pending = null },
    beginDeletion() {
      const previous = receipt, previousPending = pending
      const locked = { ...receipt, locked: true }
      save(locked); pending = null
      return { cancel() {
        if (receipt !== locked) throw new Error('account-changed')
        save(previous); pending = previousPending
      } }
    }
  }
}
