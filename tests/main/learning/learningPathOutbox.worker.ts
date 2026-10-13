const Database = require('better-sqlite3-node')
import { readFileSync, writeFileSync } from 'node:fs'
import { createLearningRepo } from '../../../src/main/features/learning/learningRepo'
import { createLearningPathOutbox } from '../../../src/main/features/learning/learningPathOutbox'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createMaterialPathLock } from '../../../src/main/features/materials/materialPathLock'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new Database(spec.dbPath)
const pathLock = createMaterialPathLock(spec.lockPath, path => new Database(path, { timeout: 0 }))
function crash(stage: string) {
  if (stage !== spec.stage) return
  writeFileSync(spec.marker, stage)
  if (stage === 'live') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
  else process.kill(process.pid, 'SIGKILL')
}
let outbox: ReturnType<typeof createLearningPathOutbox>
const repo = createLearningRepo({ getCourseFolder: id => spec.folders[id], listCourseIds: () => Object.keys(spec.folders), pathLock,
  beforePathAccess: () => outbox.flush(), beforeCommit() { crash('before-json'); crash('live') }, onChanged() { crash('after-json') } })
outbox = createLearningPathOutbox({ db, pathLock, repoint: input => repo.repoint(input) })
const prepare = db.prepare.bind(db)
db.prepare = (sql: string) => {
  const statement = prepare(sql)
  if (sql.startsWith('DELETE FROM learning_path_outbox')) {
    const run = statement.run.bind(statement)
    statement.run = (...args: any[]) => { crash('before-ack'); const result = run(...args); crash('during-ack'); return result }
  }
  return statement
}
const materials = createMaterialsRepo({ db, pathLock, getCourseFolder: id => spec.folders[id], revealItem() {}, trashItem: async () => {},
  onPathChanged(change) { repointMaterialPath({ ...change, db, courseFolder: spec.folders[change.courseId] }); outbox.enqueue(change); crash('before-sql-commit') } })
async function main() {
  materials.recoverPathChanges()
  if (spec.action === 'move') {
    await materials.rename({ courseId: spec.courseId, relPath: 'old.md', newName: 'new.md' })
    crash('after-sql-commit')
  }
  await outbox.flush()
  crash('after-ack')
  process.stdout.write(JSON.stringify({ pending: outbox.pending(), intents: db.prepare('SELECT COUNT(*) n FROM material_path_intents').get().n }))
}
main().then(() => db.close(), error => { console.error(error); process.exitCode = 1; db.close() })
