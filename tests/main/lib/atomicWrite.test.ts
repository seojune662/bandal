import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  quarantineFile,
  writeFileAtomic
} from '../../../src/main/lib/atomicWrite'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-atomic-write-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('writeFileAtomic', () => {
  test('atomically replaces string and Buffer data with the requested mode', () => {
    const directory = temporaryDirectory()
    const file = join(directory, 'state.json')
    writeFileSync(file, 'old', 'utf8')

    writeFileAtomic(file, 'new')
    expect(readFileSync(file, 'utf8')).toBe('new')

    writeFileAtomic(file, Buffer.from('private'), { mode: 0o600 })
    expect(readFileSync(file, 'utf8')).toBe('private')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp')))
      .toEqual([])
  })

  test('removes its temporary file when the final rename fails', () => {
    const directory = temporaryDirectory()
    const targetDirectory = join(directory, 'occupied')
    mkdirSync(targetDirectory)

    expect(() => writeFileAtomic(targetDirectory, 'data')).toThrow()
    expect(statSync(targetDirectory).isDirectory()).toBe(true)
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp')))
      .toEqual([])
  })
})

describe('quarantineFile', () => {
  test('renames corrupt bytes and adds a suffix on collision', () => {
    const directory = temporaryDirectory()
    const file = join(directory, 'settings.json')
    const now = new Date('2026-08-22T03:04:05.000Z')
    const collision = `${file}.corrupt-${now.toISOString()}`
    writeFileSync(file, 'corrupt', 'utf8')
    writeFileSync(collision, 'older', 'utf8')

    const quarantined = quarantineFile(file, now)

    expect(quarantined).toBe(`${collision}-1`)
    expect(readFileSync(quarantined as string, 'utf8')).toBe('corrupt')
    expect(existsSync(file)).toBe(false)
    expect(quarantineFile(file, now)).toBeNull()
  })
})
