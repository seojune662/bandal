import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { loadIdentity, ownMaxSeq, takeSeq } from '../../../src/main/features/sync/identity'

let dir: string, file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bandal-identity-'))
  file = join(dir, 'sync', 'state.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('the same machine keeps its device id and seq across launches', () => {
  const first = loadIdentity(file, 'machine-a')
  expect(takeSeq(file, first, [])).toBe(1)
  expect(takeSeq(file, first, [])).toBe(2)
  const again = loadIdentity(file, 'machine-a')
  expect(again).toEqual({ device_id: first.device_id, machine: 'machine-a', next_seq: 3 })
  expect(statSync(file).mode & 0o777).toBe(0o600)
})

test('M25: a state file copied onto another machine starts a new device', () => {
  const original = loadIdentity(file, 'machine-a')
  takeSeq(file, original, [])
  const copied = loadIdentity(file, 'machine-b')
  expect(copied.device_id).not.toBe(original.device_id)
  expect(copied.next_seq).toBe(1)
})

test('M24: after the state file is lost, seq continues past the files the device left in the root', () => {
  const device = loadIdentity(file, 'machine-a')
  const root = [
    `log/${device.device_id}/00000007.json`,
    `ink/d0000000-0000-4000-8000-000000000001/3/${device.device_id}-00000012.json.gz`,
    `notes/d0000000-0000-4000-8000-000000000002/${device.device_id}-00000009.md`,
    'log/bbbbbbbb-0000-4000-8000-000000000002/00000099.json'
  ]
  rmSync(file)
  expect(takeSeq(file, device, root)).toBe(13)
  expect(takeSeq(file, device, root)).toBe(14)
})

test('an unreadable state file is a new device, and keys owned by other modules survive saves', () => {
  const device = loadIdentity(file, 'machine-a')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), provider: 'icloud' }))
  takeSeq(file, device, [])
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ provider: 'icloud', device_id: device.device_id, next_seq: 2 })
  writeFileSync(file, '{not json')
  expect(loadIdentity(file, 'machine-a').device_id).not.toBe(device.device_id)
})

test('ownMaxSeq reads only this device\'s file names', () => {
  const me = 'aaaaaaaa-0000-4000-8000-000000000001'
  expect(ownMaxSeq([`log/${me}/00000003.json.tmp`, `notes/x/${me}-00000004.md`, `log/${me}/00000002.json`], me)).toBe(4)
  expect(ownMaxSeq([], me)).toBe(0)
})
