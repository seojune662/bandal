import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createLearningRepo, type LearningRepo } from '../../../src/main/features/learning/learningRepo'
import { createLearningPathOutbox } from '../../../src/main/features/learning/learningPathOutbox'
import { createMaterialPathJournal } from '../../../src/main/features/materials/materialPathJournal'
import { createMaterialPathLock } from '../../../src/main/features/materials/materialPathLock'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createFavoritesRepo } from '../../../src/main/features/favorites/favoritesRepo'
const require = createRequire(import.meta.url), SQLite = require('better-sqlite3-node')
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild')
let worker: string
beforeAll(() => {
  worker = buildSync({ entryPoints: [join(process.cwd(), 'tests/main/learning/learningPathOutbox.worker.ts')], platform: 'node', format: 'cjs', bundle: true, write: false,
    external: ['better-sqlite3', 'better-sqlite3-node'] }).outputFiles[0].text
    .replace(/require\("better-sqlite3-node"\)/g, `require(${JSON.stringify(require.resolve('better-sqlite3-node'))})`)
    .replace(/require\("better-sqlite3"\)/g, `require(${JSON.stringify(require.resolve('better-sqlite3'))})`)
})
describe('durable learning path updates', () => {
  let ctx: TestDb, folder: string, courseId: string, repo: LearningRepo, outbox: ReturnType<typeof createLearningPathOutbox>, lock: ReturnType<typeof createMaterialPathLock>
  let spec: any, child: ChildProcess | undefined
  const binding = (project = 'first') => ({ courseId, rootRelPath: project })
  const statePath = (project = 'first') => join(folder, project, '.bandal/learning/state.json')
  const state = (project = 'first') => JSON.parse(readFileSync(statePath(project), 'utf8'))
  const change = (fromRelPath = 'old.md', toRelPath = 'new.md') => ({ courseId, fromRelPath, toRelPath, isDirectory: false })
  const run = (overrides: object = {}) => {
    writeFileSync(spec.config, JSON.stringify({ ...spec, ...overrides }))
    return spawnSync(process.execPath, [spec.workerPath, spec.config], { encoding: 'utf8' })
  }
  beforeEach(async () => {
    ctx = createTestDb()
    const course = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'Courses') }).create({ name: 'Source', color: 'green' })
    folder = course.folderPath; courseId = course.id
    lock = createMaterialPathLock(join(ctx.dir, 'material-path-lock.db'), path => new SQLite(path, { timeout: 0 }))
    repo = createLearningRepo({ getCourseFolder: () => folder, listCourseIds: () => [courseId], pathLock: lock, beforePathAccess: () => outbox.flush() })
    outbox = createLearningPathOutbox({ db: ctx.db, pathLock: lock, repoint: input => repo.repoint(input) })
    writeFileSync(join(folder, 'old.md'), 'Retained source evidence.')
    for (const project of ['first', 'second']) {
      await repo.create({ binding: binding(project), name: project, topic: 'Retained knowledge' })
      await repo.putArtifact({ binding: binding(project), artifact: { kind: 'cards', title: 'Evidence', cards: [
        { id: 'c1', front: 'Kept?', back: 'Yes', sourceRefs: [{ kind: 'material', pathScope: 'course', relPath: 'old.md', quote: 'Retained source evidence.' }] }
      ] } })
    }
    createFavoritesRepo(ctx.db).add({ courseId, label: 'Source', descriptor: { kind: 'note', payload: { courseId, relPath: 'old.md' } } })
    spec = { dbPath: ctx.db.name, folders: { [courseId]: folder }, courseId, lockPath: join(ctx.dir, 'material-path-lock.db'), marker: join(ctx.dir, 'marker'), config: join(ctx.dir, 'worker.json'), workerPath: join(ctx.dir, 'worker.cjs') }
    writeFileSync(spec.workerPath, worker)
  })
  afterEach(async () => {
    if (child) { const target = child; child = undefined; if (target.exitCode === null && target.signalCode === null) { target.kill('SIGKILL'); await new Promise(resolve => target.once('exit', resolve)) } }
    ctx.cleanup()
  })
  function assertUpdated(before: Record<string, any>, path = 'new.md') {
    for (const project of ['first', 'second']) {
      const current = state(project)
      expect(current.cards[0].sourceRefs[0].relPath).toBe(path)
      expect(current.artifacts[0].sourceRefs[0].relPath).toBe(path)
      expect(current.revision).toBe(before[project].revision + 1)
      expect(current.pathAliases).toHaveLength(1)
      expect(current.pathAliases[0].operationId).toMatch(/^[a-f0-9-]{36}$/)
      expect(current.cards[0].id).toBe(before[project].cards[0].id)
      expect(current.history).toEqual(before[project].history)
      const immutablePath = join(folder, project, current.artifacts[0].relPath)
      expect(JSON.parse(readFileSync(immutablePath, 'utf8')).cards[0].sourceRefs[0].relPath).toBe('old.md')
    }
  }
  test.each(['before-sql-commit', 'after-sql-commit', 'before-json', 'after-json', 'before-ack', 'during-ack', 'after-ack'])('SIGKILL at %s resumes canonical and JSON paths without duplicate aliases or lost cards', stage => {
    const before = { first: state(), second: state('second') }
    const crashed = run({ action: 'move', stage }); expect(crashed.signal, crashed.stderr).toBe('SIGKILL')
    const result = run(); expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ pending: 0, intents: 0 })
    assertUpdated(before)
    expect(readFileSync(join(folder, 'new.md'), 'utf8')).toBe('Retained source evidence.')
    expect(JSON.parse((ctx.db.prepare('SELECT descriptor_json FROM favorites').get() as any).descriptor_json).payload.relPath).toBe('new.md')
    const bytes = readFileSync(statePath(), 'utf8'); expect(run().status).toBe(0); expect(readFileSync(statePath(), 'utf8')).toBe(bytes)
  })
  test('enqueue and canonical SQL roll back together and enqueue outside a transaction is refused', () => {
    expect(() => outbox.enqueue(change())).toThrow('transaction')
    expect(() => ctx.db.transaction(() => { ctx.db.prepare("UPDATE favorites SET label='Changed'").run(); outbox.enqueue(change()); throw new Error('injected SQL failure') })()).toThrow('injected')
    expect(outbox.pending()).toBe(0); expect((ctx.db.prepare('SELECT label FROM favorites').get() as any).label).toBe('Source')
  })
  test('replays a -> b -> a -> c in order, including immutable citation aliases', async () => {
    const before = state()
    renameSync(join(folder, 'old.md'), join(folder, 'final.md'))
    ctx.db.transaction(() => { outbox.enqueue(change('old.md', 'intermediate.md')); outbox.enqueue(change('intermediate.md', 'old.md')); outbox.enqueue(change('old.md', 'final.md')) })()
    const current = await repo.read(binding()) // recovery is part of normal access
    expect(current.cards[0]!.sourceRefs[0]!.relPath).toBe('final.md'); expect(current.revision).toBe(before.revision + 3)
    expect(current.pathAliases).toHaveLength(3); expect(outbox.pending()).toBe(0)
    const artifact = await repo.readArtifact(binding(), current.artifacts[0]!.id)
    expect(artifact.kind).toBe('cards'); if (artifact.kind === 'cards') expect(artifact.cards[0]!.sourceRefs[0]!.relPath).toBe('final.md')
  })
  test('preserves an external JSON edit and retries from that edit without duplicate recovery', async () => {
    renameSync(join(folder, 'old.md'), join(folder, 'new.md'))
    const before = state(), changed = { ...before, revision: before.revision + 1, name: 'External user title' }
    let once = true
    const racingRepo = createLearningRepo({ getCourseFolder: () => folder, listCourseIds: () => [courseId], beforeCommit() {
      if (once) { once = false; writeFileSync(statePath(), JSON.stringify(changed, null, 2) + '\n') }
    } })
    const racing = createLearningPathOutbox({ db: ctx.db, pathLock: lock, repoint: input => racingRepo.repoint(input) })
    ctx.db.transaction(() => racing.enqueue(change()))()
    await expect(racing.flush()).rejects.toThrow('다른 곳에서 변경')
    expect(state()).toEqual(changed); expect(racing.pending()).toBe(1)
    await racing.flush(); expect(racing.pending()).toBe(0)
    expect(state().name).toBe('External user title'); expect(state().revision).toBe(changed.revision + 1)
  })
  test('keeps a failed ACK pending and does not reapply a completed JSON mutation', async () => {
    renameSync(join(folder, 'old.md'), join(folder, 'new.md'))
    ctx.db.transaction(() => outbox.enqueue(change()))()
    ctx.db.exec("CREATE TRIGGER refuse_learning_ack BEFORE DELETE ON learning_path_outbox BEGIN SELECT RAISE(ABORT,'injected ack failure'); END")
    await expect(outbox.flush()).rejects.toThrow('injected ack failure')
    const bytes = [readFileSync(statePath(), 'utf8'), readFileSync(statePath('second'), 'utf8')]
    expect(outbox.pending()).toBe(1); ctx.db.exec('DROP TRIGGER refuse_learning_ack'); await outbox.flush()
    expect(outbox.pending()).toBe(0); expect(readFileSync(statePath(), 'utf8')).toBe(bytes[0]); expect(readFileSync(statePath('second'), 'utf8')).toBe(bytes[1])
  })
  test('refuses to acknowledge an unreadable linked course and retains the error for later access', async () => {
    const broken = createLearningRepo({ getCourseFolder: id => id === courseId ? folder : join(ctx.dir, 'missing'), listCourseIds: () => [courseId, 'missing-course'] })
    const blocked = createLearningPathOutbox({ db: ctx.db, pathLock: lock, repoint: input => broken.repoint(input) })
    ctx.db.transaction(() => blocked.enqueue(change()))(); const before = readFileSync(statePath(), 'utf8')
    await expect(blocked.flush()).rejects.toThrow(); expect(blocked.pending()).toBe(1); expect(readFileSync(statePath(), 'utf8')).toBe(before)
  })
  test('a live drainer excludes another process, learning mutation and material rename; SIGKILL releases the lease', async () => {
    writeFileSync(spec.config, JSON.stringify({ ...spec, action: 'move', stage: 'live' }))
    child = spawn(process.execPath, [spec.workerPath, spec.config], { stdio: 'ignore' })
    await vi.waitFor(() => expect(existsSync(spec.marker)).toBe(true))
    const blocked = run(); expect(blocked.status).toBe(1); expect(blocked.stderr).toContain('진행 중')
    await expect(repo.updateSettings({ binding: binding(), topic: 'Concurrent update' })).rejects.toThrow('진행 중')
    const release = lock.tryAcquire(); expect(release).toBeUndefined()
    const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGKILL'); await exited; child = undefined
    const recovered = run(); expect(recovered.status, recovered.stderr).toBe(0); expect(outbox.pending()).toBe(0)
    expect(state().topic).toBe('Retained knowledge')
  })
  test('replays after the containing project directory also moved while events were pending', async () => {
    renameSync(join(folder, 'old.md'), join(folder, 'new.md'))
    renameSync(join(folder, 'first'), join(folder, 'relocated'))
    const before = state('relocated')
    ctx.db.transaction(() => {
      outbox.enqueue(change())
      outbox.enqueue({ ...change('first', 'relocated'), isDirectory: true })
    })()
    const current = await repo.read(binding('relocated'))
    expect(current.projectId).toBe(before.projectId)
    expect(current.cards[0]!.sourceRefs[0]!.relPath).toBe('new.md')
    expect(current.revision).toBe(before.revision + 2)
    expect(current.pathAliases).toHaveLength(2); expect(outbox.pending()).toBe(0)
  })
  test('retains a corrupt project and completes earlier projects just once when it is restored', async () => {
    renameSync(join(folder, 'old.md'), join(folder, 'new.md'))
    const before = { first: state(), second: state('second') }
    const bytes = readFileSync(statePath('second'), 'utf8')
    const previousPath = join(folder, 'second', '.bandal/learning/state.previous.json')
    const previous = readFileSync(previousPath, 'utf8')
    writeFileSync(statePath('second'), 'corrupt-current'); writeFileSync(previousPath, 'corrupt-previous')
    ctx.db.transaction(() => outbox.enqueue(change()))()
    await expect(outbox.flush()).rejects.toThrow('학습 경로 변경')
    expect(outbox.pending()).toBe(1); expect(readFileSync(statePath('second'), 'utf8')).toBe('corrupt-current')
    writeFileSync(statePath('second'), bytes); writeFileSync(previousPath, previous)
    await outbox.flush(); assertUpdated(before)
  })
  test('updates linked-course citations while keeping same-named local sources and portable immutable files', async () => {
    const otherFolder = join(ctx.dir, 'review-course'); mkdirSync(otherFolder)
    const folders = new Map([[courseId, folder], ['review', otherFolder]])
    let linkedPaths: ReturnType<typeof createLearningPathOutbox>
    const linked = createLearningRepo({ getCourseFolder: id => folders.get(id)!, listCourseIds: () => [...folders.keys()], pathLock: lock, beforePathAccess: () => linkedPaths.flush() })
    linkedPaths = createLearningPathOutbox({ db: ctx.db, pathLock: lock, repoint: input => linked.repoint(input) })
    const project = { courseId: 'review', rootRelPath: '' }
    await linked.create({ binding: project, name: 'Connected review', topic: 'Citations', linkedCourseId: courseId })
    writeFileSync(join(otherFolder, 'old.md'), 'Local evidence.')
    await linked.putArtifact({ binding: project, artifact: { kind: 'cards', title: 'Two sources', cards: [
      { id: 'origin', front: 'Origin', back: 'Retained', sourceRefs: [{ kind: 'material', pathScope: 'course', sourceCourseId: courseId, relPath: 'old.md', quote: 'Retained source evidence.' }] },
      { id: 'local', front: 'Local', back: 'Retained', sourceRefs: [{ kind: 'material', pathScope: 'course', relPath: 'old.md', quote: 'Local evidence.' }] }
    ] } })
    renameSync(join(folder, 'old.md'), join(folder, 'new.md'))
    ctx.db.transaction(() => linkedPaths.enqueue(change()))()
    const current = await linked.read(project)
    expect(current.cards.map(card => card.sourceRefs[0]!.relPath)).toEqual(['new.md', 'old.md'])
    const artifact = await linked.readArtifact(project, current.artifacts[0]!.id)
    if (artifact.kind !== 'cards') throw new Error('Expected card fixture')
    expect(artifact.cards.map(card => card.sourceRefs[0]!.relPath)).toEqual(['new.md', 'old.md'])
    expect(current.pathAliases![0]!.sourceCourseId).toBe(courseId)
    expect(readFileSync(join(otherFolder, 'old.md'), 'utf8')).toBe('Local evidence.')
  })
  test('does not skip an unreadable project whose linked-course metadata cannot be recovered', async () => {
    const other = join(ctx.dir, 'unknown-course'); mkdirSync(other)
    const folders = new Map([[courseId, folder], ['unknown', other]])
    const unknown = createLearningRepo({ getCourseFolder: id => folders.get(id)!, listCourseIds: () => [...folders.keys()] })
    await unknown.create({ binding: { courseId: 'unknown', rootRelPath: '' }, name: 'Linked', topic: 'Keep', linkedCourseId: courseId })
    writeFileSync(join(other, '.bandal/learning/state.json'), '{broken')
    writeFileSync(join(other, '.bandal/learning/state.previous.json'), '{broken')
    const pending = createLearningPathOutbox({ db: ctx.db, pathLock: lock, repoint: input => unknown.repoint(input) })
    ctx.db.transaction(() => pending.enqueue(change()))()
    await expect(pending.flush()).rejects.toThrow('학습 경로 변경')
    expect(pending.pending()).toBe(1)
    expect(readFileSync(join(other, '.bandal/learning/state.json'), 'utf8')).toBe('{broken')
  })
  test('a normal JSON writer owns the shared lock while publishing and a second writer fails without loss', async () => {
    let entered!: () => void, resume!: () => void
    const atCommit = new Promise<void>(resolve => { entered = resolve })
    const continueCommit = new Promise<void>(resolve => { resume = resolve })
    const writer = createLearningRepo({ getCourseFolder: () => folder, pathLock: lock, beforeCommit: async () => { entered(); await continueCommit } })
    const competing = createLearningRepo({ getCourseFolder: () => folder, pathLock: lock })
    const saving = writer.updateSettings({ binding: binding(), topic: 'Saved user topic' })
    await atCommit
    try { await expect(competing.updateSettings({ binding: binding(), topic: 'Lost race' })).rejects.toThrow('진행 중') }
    finally { resume() }
    await saving
    expect(state().topic).toBe('Saved user topic')
  })
  test('does not replay through an unresolved move in another course containing linked projects', async () => {
    createMaterialPathJournal(ctx.db, () => folder).begin({ ...change(), courseId: 'other-course' }, folder)
    ctx.db.transaction(() => outbox.enqueue(change()))()
    const before = readFileSync(statePath(), 'utf8')
    await expect(outbox.flush()).rejects.toThrow('자료 경로 복구')
    expect(outbox.pending()).toBe(1); expect(readFileSync(statePath(), 'utf8')).toBe(before)
  })
  test('queues simultaneous course discovery and project reads in this process without false lock failures', async () => {
    const results = await Promise.all([
      repo.discover(courseId), repo.discover(courseId), repo.read(binding()), repo.read(binding('second')),
      repo.updateSettings({ binding: binding(), topic: 'First updated' }),
      repo.updateSettings({ binding: binding('second'), topic: 'Second updated' })
    ])
    expect(results[0]).toHaveLength(2); expect(results[1]).toHaveLength(2)
    expect(state().topic).toBe('First updated'); expect(state('second').topic).toBe('Second updated')
  })
  test('explicit projection scope reuses one lock, excludes concurrent writers and revokes the scoped repo', async () => {
    let leaked: LearningRepo | undefined
    let started!: () => void, resume!: () => void
    const atScope = new Promise<void>(resolve => { started = resolve })
    const finish = new Promise<void>(resolve => { resume = resolve })
    const snapshots = repo.withExclusivePathAccess(async scoped => {
      leaked = scoped
      expect(lock.tryAcquire()).toBeUndefined()
      const values = await Promise.all([scoped.discover(courseId), scoped.read(binding()), scoped.read(binding('second'))])
      started(); await finish
      return values
    })
    await atScope
    let normalFinished = false
    const normal = repo.updateSettings({ binding: binding(), topic: 'After projection' }).then(value => { normalFinished = true; return value })
    await new Promise(resolve => setTimeout(resolve, 10)); expect(normalFinished).toBe(false)
    resume(); expect((await snapshots)[0]).toHaveLength(2); await normal
    await expect(leaked!.read(binding())).rejects.toThrow('범위가 종료')
    expect(state().topic).toBe('After projection')
  })
  test('cannot reuse a receipt ID for a different rename', async () => {
    const operationId = 'reused-operation'
    await repo.repoint({ ...change(), operationId })
    const before = readFileSync(statePath(), 'utf8')
    await expect(repo.repoint({ ...change('new.md', 'other.md'), operationId })).rejects.toThrow('재사용')
    expect(readFileSync(statePath(), 'utf8')).toBe(before)
  })
})
