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
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import {
  quarantineFile,
  writeFileAtomic
} from '../../../src/main/lib/atomicWrite'

const temporaryDirectories: string[] = []
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const replacementFault = vi.hoisted(() => ({
  target: '', failures: 0, attempts: 0, temporary: '',
  error: null as NodeJS.ErrnoException | null,
  observe: undefined as ((temporary: string, target: string) => void) | undefined
}))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: (...args: Parameters<typeof actual.renameSync>) => {
    const [source, destination] = args.map(String)
    if (source?.endsWith('.tmp') && destination === replacementFault.target) {
      replacementFault.attempts += 1; replacementFault.temporary = source
      replacementFault.observe?.(source, destination)
      if (replacementFault.failures > 0) {
        replacementFault.failures -= 1
        throw replacementFault.error
      }
    }
    return actual.renameSync(...args)
  } }
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platformDescriptor)
  replacementFault.target = ''; replacementFault.failures = 0; replacementFault.attempts = 0; replacementFault.temporary = ''
  replacementFault.error = null; replacementFault.observe = undefined
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function refuseReplacement(target: string, failures: number, code = 'EPERM', platform: NodeJS.Platform = 'win32') {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform })
  replacementFault.target = target; replacementFault.failures = failures
  replacementFault.error = Object.assign(new Error('Injected Windows replacement lock'), { code })
  return vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
}

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

  test.each(['EPERM', 'EBUSY'])('retries a temporary Windows %s replacement lock while old bytes remain readable', code => {
    const directory = temporaryDirectory(), file = join(directory, 'state.json')
    writeFileSync(file, 'old complete revision', 'utf8')
    const wait = refuseReplacement(file, 2, code)
    const sourcePaths: string[] = []
    replacementFault.observe = (temporary, target) => {
      sourcePaths.push(temporary)
      expect(readFileSync(target, 'utf8')).toBe('old complete revision')
      expect(readFileSync(temporary, 'utf8')).toBe('new complete revision')
    }

    writeFileAtomic(file, 'new complete revision')

    expect(readFileSync(file, 'utf8')).toBe('new complete revision')
    expect(replacementFault.attempts).toBe(3)
    expect(new Set(sourcePaths).size).toBe(1)
    expect(wait.mock.calls.map(([, , , delay]) => delay)).toEqual([50, 100])
    expect(readdirSync(directory)).toEqual(['state.json'])
  })

  test('exhausts a permanent Windows lock, preserves the original, and cleans up the unpublished temp', () => {
    const directory = temporaryDirectory(), file = join(directory, 'state.json')
    writeFileSync(file, 'original complete revision', 'utf8')
    const wait = refuseReplacement(file, Number.POSITIVE_INFINITY)
    replacementFault.observe = (temporary, target) => {
      expect(readFileSync(target, 'utf8')).toBe('original complete revision')
      expect(readFileSync(temporary, 'utf8')).toBe('unpublished revision')
    }

    expect(() => writeFileAtomic(file, 'unpublished revision')).toThrow(replacementFault.error!)

    expect(replacementFault.attempts).toBe(6)
    expect(wait.mock.calls.map(([, , , delay]) => delay)).toEqual([50, 100, 200, 400, 800])
    expect(readFileSync(file, 'utf8')).toBe('original complete revision')
    expect(existsSync(replacementFault.temporary)).toBe(false)
    expect(readdirSync(directory)).toEqual(['state.json'])
  })

  test.each([['darwin', 'EPERM'], ['win32', 'EACCES'], ['win32', 'ENOENT']] as const)('does not retry %s %s failures', (platform, code) => {
    const directory = temporaryDirectory(), file = join(directory, 'state.json')
    writeFileSync(file, 'original', 'utf8')
    const wait = refuseReplacement(file, Number.POSITIVE_INFINITY, code, platform)

    expect(() => writeFileAtomic(file, 'new')).toThrow(replacementFault.error!)

    expect(replacementFault.attempts).toBe(1)
    expect(wait).not.toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe('original')
    expect(readdirSync(directory)).toEqual(['state.json'])
  })

  test('a note rename publishes its canonical heading after a temporary replacement lock', () => {
    const directory = temporaryDirectory(), source = join(directory, 'moving.md'), destination = join(directory, 'renamed.md')
    writeFileSync(source, '# moving\n\n보존할 최신 본문\n', 'utf8')
    refuseReplacement(destination, 2)
    replacementFault.observe = () => expect(readFileSync(destination, 'utf8')).toBe('# moving\n\n보존할 최신 본문\n')
    const changed = vi.fn(() => expect(readFileSync(destination, 'utf8')).toBe('# renamed\n\n보존할 최신 본문\n'))
    const repo = createNotesRepo({ getCourseFolder: () => directory, onPathChanged: changed })

    const renamed = repo.rename({ courseId: 'course', relPath: 'moving.md', newName: 'renamed.md' })

    expect(renamed.relPath).toBe('renamed.md')
    expect(renamed.markdown).toBe('# renamed\n\n보존할 최신 본문\n')
    expect(changed).toHaveBeenCalledExactlyOnceWith({ courseId: 'course', fromRelPath: 'moving.md', toRelPath: 'renamed.md', isDirectory: false })
    expect(existsSync(source)).toBe(false)
    expect(readdirSync(directory)).toEqual(['renamed.md'])
  })

  test('an exhausted note replacement lock preserves rename rollback and original body with no temp left', () => {
    const directory = temporaryDirectory(), source = join(directory, 'moving.md'), destination = join(directory, 'renamed.md')
    const original = '# moving\n\n보존할 최신 본문\n'
    writeFileSync(source, original, 'utf8')
    refuseReplacement(destination, Number.POSITIVE_INFINITY)
    const changed = vi.fn()
    const repo = createNotesRepo({ getCourseFolder: () => directory, onPathChanged: changed })

    expect(() => repo.rename({ courseId: 'course', relPath: 'moving.md', newName: 'renamed.md' })).toThrow(replacementFault.error!)

    expect(replacementFault.attempts).toBe(6)
    expect(readFileSync(source, 'utf8')).toBe(original)
    expect(existsSync(destination)).toBe(false)
    expect(readdirSync(directory)).toEqual(['moving.md'])
    expect(changed).not.toHaveBeenCalled()
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
