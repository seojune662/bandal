import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createLearningRepo, LEARNING_DATA_DIR, type LearningRepo } from '../../../src/main/features/learning/learningRepo'
import { splitLearningParagraphs } from '../../../src/main/features/learning/model'

const fault = vi.hoisted(() => ({
  destination: '', temporary: '', failures: 0, attempts: 0,
  code: 'EPERM', waited: undefined as (() => Promise<void>) | undefined,
  baselineDirectory: '', beforeBaseline: undefined as (() => Promise<void>) | undefined
}))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
    if (String(args[0]) === fault.baselineDirectory) await fault.beforeBaseline?.()
    return actual.mkdir(...args)
  } }
})
// Exercise the real retry helper and real file publication on any local OS.
// Only the Windows filesystem refusal is injected at the rename boundary.
vi.mock('../../../src/main/features/materials/renameWithRetry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/main/features/materials/renameWithRetry')>()
  const filesystem = await import('node:fs/promises')
  return {
    renameWithRetry: (source: string, destination: string, beforeAttempt: () => void | Promise<void>) => actual.renameWithRetry(source, destination, beforeAttempt, {
      platform: 'win32',
      rename: async (from, to) => {
        if (to === fault.destination) {
          fault.attempts += 1; fault.temporary = String(from)
          if (fault.failures > 0) {
            fault.failures -= 1
            throw Object.assign(new Error('Windows file sharing refusal'), { code: fault.code })
          }
        }
        await filesystem.rename(from, to)
      },
      wait: async () => { await fault.waited?.() }
    })
  }
})

const binding = { courseId: 'course', rootRelPath: 'Reading' }
const sentence = 'The climate is changing quickly.'
const word = { binding, surface: 'climate', sentence, sourceRef: { kind: 'article' as const, articleId: 'article', paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'climate', start: 4, end: 11 } }
let directory: string
let statePath: string
let repo: LearningRepo
beforeEach(async () => {
  fault.destination = ''; fault.temporary = ''; fault.failures = 0; fault.attempts = 0; fault.code = 'EPERM'; fault.waited = undefined
  fault.baselineDirectory = ''; fault.beforeBaseline = undefined
  directory = await mkdtemp(join(tmpdir(), 'bandal-learning-atomic-'))
  repo = createLearningRepo({ getCourseFolder: () => directory })
  await repo.create({ binding, name: 'Reading', topic: 'Climate' })
  await repo.addArticle({ binding, article: { id: 'article', title: 'Climate', sourceUrl: 'https://example.com/climate', paragraphs: splitLearningParagraphs(sentence) } })
  statePath = join(directory, binding.rootRelPath, LEARNING_DATA_DIR, 'state.json')
  fault.destination = statePath
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

test.each(['EPERM', 'EBUSY'])('a temporary Windows %s refusal preserves the visible revision until the atomic publication succeeds', async code => {
  const previous = await readFile(statePath, 'utf8')
  fault.code = code; fault.failures = 2
  fault.waited = async () => {
    expect(await readFile(statePath, 'utf8')).toBe(previous)
    expect(JSON.parse(await readFile(fault.temporary, 'utf8')).words).toHaveLength(1)
  }
  const saved = await repo.saveWord(word)
  expect(fault.attempts).toBe(3)
  expect(saved.words[0]?.surface).toBe('climate')
  expect((await repo.read(binding)).words).toHaveLength(1)
  expect(await readFile(join(directory, binding.rootRelPath, LEARNING_DATA_DIR, 'state.previous.json'), 'utf8')).toBe(previous)
  expect((await readdir(join(directory, binding.rootRelPath, LEARNING_DATA_DIR))).some(name => name.endsWith('.tmp'))).toBe(false)
})

test('an exhausted Windows publication retry leaves the original file readable and removes the unpublished temporary file', async () => {
  const previous = await readFile(statePath, 'utf8')
  fault.failures = Number.POSITIVE_INFINITY
  await expect(repo.saveWord(word)).rejects.toMatchObject({ code: 'EPERM' })
  expect(fault.attempts).toBe(6)
  expect(await readFile(statePath, 'utf8')).toBe(previous)
  expect((await repo.read(binding)).words).toHaveLength(0)
  expect((await readdir(join(directory, binding.rootRelPath, LEARNING_DATA_DIR))).some(name => name.endsWith('.tmp'))).toBe(false)
})

test('a changed external revision during the retry is retained instead of overwritten by the stale pending save', async () => {
  const previous = await readFile(statePath, 'utf8')
  const external = { ...JSON.parse(previous), name: 'External revision', revision: JSON.parse(previous).revision + 1 }
  const bytes = JSON.stringify(external, null, 2)
  fault.failures = 1
  fault.waited = async () => {
    const temporary = `${statePath}.external`
    await writeFile(temporary, bytes)
    await rename(temporary, statePath)
  }
  await expect(repo.saveWord(word)).rejects.toThrow('저장 중에 변경')
  expect(fault.attempts).toBe(1)
  expect(await readFile(statePath, 'utf8')).toBe(bytes)
  expect((await repo.read(binding)).name).toBe('External revision')
  expect((await readdir(join(directory, binding.rootRelPath, LEARNING_DATA_DIR))).some(name => name.endsWith('.tmp'))).toBe(false)
})

test('a vocabulary export edited during retry keeps the user text, records an export warning and generates a separate copy next time', async () => {
  const projectRoot = join(directory, binding.rootRelPath)
  const vocabularyPath = join(projectRoot, '단어장.md')
  fault.destination = vocabularyPath; fault.failures = 1
  fault.waited = async () => { await writeFile(vocabularyPath, '# My vocabulary\n\nKeep this personal explanation.\n') }
  const saved = await repo.saveWord(word)
  const edited = await readFile(vocabularyPath, 'utf8')
  expect(edited).toContain('Keep this personal explanation.')
  expect(saved.words).toHaveLength(1)
  expect(saved.warnings).toEqual([expect.stringContaining('단어장.md')])
  expect(fault.attempts).toBe(1)
  expect((await readdir(projectRoot)).some(name => name.endsWith('.tmp'))).toBe(false)
  const regenerated = await repo.updateWord({ binding, wordId: saved.words[0]!.id, meaning: '기후' })
  expect(await readFile(vocabularyPath, 'utf8')).toBe(edited)
  expect(regenerated.exports.some(entry => entry.relPath === '단어장-2.md')).toBe(true)
  expect(await readFile(join(projectRoot, '단어장-2.md'), 'utf8')).toContain('기후')
})

test('an export edit after its initial hash check is preserved even when atomic publication captures those edited bytes as its baseline', async () => {
  const projectRoot = join(directory, binding.rootRelPath)
  const vocabularyPath = join(projectRoot, '단어장.md')
  const edited = '# My edit before the temporary file opens\n'
  fault.destination = vocabularyPath
  fault.baselineDirectory = projectRoot
  fault.beforeBaseline = async () => {
    fault.beforeBaseline = undefined
    await writeFile(vocabularyPath, edited)
  }
  const saved = await repo.saveWord(word)
  expect(await readFile(vocabularyPath, 'utf8')).toBe(edited)
  expect(saved.words).toHaveLength(1)
  expect(saved.warnings).toEqual([expect.stringContaining('단어장.md')])
  expect(fault.attempts).toBe(0)
  expect((await readdir(projectRoot)).some(name => name.endsWith('.tmp'))).toBe(false)
})

test('a new immutable destination created by another writer during retry is preserved and never added to the pending project', async () => {
  const articlePath = join(directory, binding.rootRelPath, LEARNING_DATA_DIR, 'articles', 'new-article.json')
  fault.destination = articlePath; fault.failures = 1
  fault.waited = async () => { await writeFile(articlePath, '{"ownedBy":"external"}') }
  await expect(repo.addArticle({ binding, article: { id: 'new-article', title: 'Other', sourceUrl: 'https://example.com/other', paragraphs: splitLearningParagraphs('Different evidence appears in another source.') } })).rejects.toThrow('저장 중에 변경')
  expect(await readFile(articlePath, 'utf8')).toBe('{"ownedBy":"external"}')
  expect((await repo.read(binding)).articles.map(article => article.id)).toEqual(['article'])
  expect(fault.attempts).toBe(1)
  expect((await readdir(join(directory, binding.rootRelPath, LEARNING_DATA_DIR, 'articles'))).some(name => name.endsWith('.tmp'))).toBe(false)
})
