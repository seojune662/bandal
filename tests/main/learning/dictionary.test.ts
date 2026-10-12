import { afterEach, describe, expect, test, vi } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Sqlite from 'better-sqlite3-node'
import { createDictionaryService } from '../../../src/main/features/learning/dictionary'
import { registerLearningHandlers } from '../../../src/main/ipc/learningHandlers'
import type { LearningIpcContract } from '../../../src/shared/ipc/learningContract'

const directory = resolve('resources/dictionary')
const services: ReturnType<typeof createDictionaryService>[] = []
const temporaryDirectories: string[] = []
function service(resourceDirectory = directory) {
  const openDatabase = vi.fn((filePath: string) => new Sqlite(filePath, { readonly: true, fileMustExist: true }))
  const dictionary = createDictionaryService({ directory: resourceDirectory, openDatabase })
  services.push(dictionary)
  return { ...dictionary, openDatabase }
}
function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'bandal-dictionary-'))
  temporaryDirectories.push(path)
  return path
}
afterEach(() => {
  for (const dictionary of services.splice(0)) dictionary.dispose()
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('bundled offline English–Korean dictionary', () => {
  test('reads real Korean senses, pronunciation and preserved source without a network or AI dependency', () => {
    const dictionary = service()
    const result = dictionary.lookup('inflation')
    expect(result.status).toBe('found')
    expect(result.entries[0]).toMatchObject({
      headword: 'inflation', partOfSpeech: '명사', pronunciation: '/ɪnˈfleɪ.ʃən/',
      source: { datasetVersion: 'koreader-dicts-en-ko-v1.2.0', headword: 'inflation', url: 'https://en.wiktionary.org/wiki/inflation#English' }
    })
    expect(result.entries[0].senses[0].meaning).toContain('인플레이션')
    expect(result.entries[0].senses[0].definition).toBeTruthy()
    expect(dictionary.lookup('  “INFLATION,” ')).toEqual(result)
    expect(dictionary.openDatabase).toHaveBeenCalledTimes(1)
    expect(dictionary.lookup('inflation')).toBe(result)
    expect(dictionary.openDatabase.mock.results[0].value.readonly).toBe(true)
    expect(() => dictionary.openDatabase.mock.results[0].value.exec('DELETE FROM entries')).toThrow()
  })

  test.each([['ran', 'run'], ['geese', 'goose'], ['towards', 'toward']])('resolves %s through the bundled inflection index', (word, lemma) => {
    const result = service().lookup(word)
    expect(result.status).toBe('found')
    expect(result.entries.some(entry => entry.headword === lemma)).toBe(true)
  })

  test('keeps the direct meaning first and includes alternate lemma meanings', () => {
    const dictionary = service()
    const running = dictionary.lookup('running')
    expect(running.entries[0].headword).toBe('running')
    expect(running.entries.some(entry => entry.headword === 'run')).toBe(true)
    const read = dictionary.lookup('read')
    expect(read.entries[0].headword).toBe('read')
    expect(read.entries[0].senses.some(sense => sense.meaning.includes('읽다'))).toBe(true)
    const bank = dictionary.lookup('bank')
    expect(bank.entries.flatMap(entry => entry.senses.map(sense => sense.meaning))).toEqual(expect.arrayContaining(['은행', '둑']))
  })

  test('unknown words and invalid input are explicit misses', () => {
    const dictionary = service()
    for (const text of ['', null, undefined, {}, 'x'.repeat(161), '<script>alert(1)</script>', 'hello; DROP TABLE entries']) {
      expect(dictionary.lookup(text)).toEqual({ status: 'not-found', entries: [] })
    }
    expect(dictionary.openDatabase).not.toHaveBeenCalled()
    expect(dictionary.lookup('definitelynotadictionaryword')).toEqual({ status: 'not-found', entries: [] })
    expect(dictionary.lookup('aerodynamics')).toEqual({ status: 'not-found', entries: [] })
  })

  test('a missing package remains unavailable and never creates an empty database', () => {
    const path = temporaryDirectory()
    const dictionary = service(path)
    expect(dictionary.lookup('run')).toEqual({ status: 'unavailable', entries: [] })
    expect(dictionary.lookup('bank')).toEqual({ status: 'unavailable', entries: [] })
    expect(dictionary.openDatabase).not.toHaveBeenCalled()
    expect(existsSync(join(path, 'en-ko.sqlite'))).toBe(false)
  })

  test('rejects a corrupt resource before opening SQLite', () => {
    const path = temporaryDirectory()
    copyFileSync(join(directory, 'manifest.json'), join(path, 'manifest.json'))
    const bytes = readFileSync(join(directory, 'en-ko.sqlite'))
    bytes[bytes.length - 1] ^= 1
    writeFileSync(join(path, 'en-ko.sqlite'), bytes)
    const dictionary = service(path)
    expect(dictionary.lookup('run')).toEqual({ status: 'unavailable', entries: [] })
    expect(dictionary.openDatabase).not.toHaveBeenCalled()
  })

  test('rejects an unsupported manifest instead of loading a different dataset', () => {
    const path = temporaryDirectory()
    writeFileSync(join(path, 'manifest.json'), JSON.stringify({ schemaVersion: 2 }))
    expect(service(path).lookup('run')).toEqual({ status: 'unavailable', entries: [] })
  })

  test('registers dictionary lookup independently of project or AI setup', () => {
    const dictionary = service()
    const handlers = new Map<keyof LearningIpcContract, (input: unknown) => unknown>()
    registerLearningHandlers((channel, handler) => handlers.set(channel, handler as (input: unknown) => unknown), {
      dictionary
    } as Parameters<typeof registerLearningHandlers>[1])
    expect(handlers.get('learning:lookupDictionary')!({ text: 'tariff' })).toMatchObject({ status: 'found' })
  })
})
