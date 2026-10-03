import type { Database } from 'better-sqlite3'
import type { LearningProjectSnapshot, LearningProjectSummary } from '../../../shared/types/learning'

/** Derived only. A copied project restores itself without this database. */
export function createLearningCache(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS learning_projects_cache (
    course_id TEXT NOT NULL, root_rel_path TEXT NOT NULL, project_id TEXT NOT NULL,
    name TEXT NOT NULL, topic TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(course_id, root_rel_path)
  ); CREATE TABLE IF NOT EXISTS learning_words_cache (
    course_id TEXT NOT NULL, root_rel_path TEXT NOT NULL, word_id TEXT NOT NULL,
    surface TEXT NOT NULL, meaning TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(course_id, root_rel_path, word_id)
  )`)
  const upsert = db.prepare(`INSERT INTO learning_projects_cache VALUES (@courseId,@rootRelPath,@projectId,@name,@topic,@updatedAt)
    ON CONFLICT(course_id,root_rel_path) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,topic=excluded.topic,updated_at=excluded.updated_at`)
  const removeWords = db.prepare('DELETE FROM learning_words_cache WHERE course_id=? AND root_rel_path=?')
  const insertWord = db.prepare('INSERT INTO learning_words_cache VALUES (?,?,?,?,?,?)')
  return {
    replaceCourse(courseId: string, projects: LearningProjectSummary[]) {
      db.transaction(() => {
        db.prepare('DELETE FROM learning_projects_cache WHERE course_id=?').run(courseId)
        for (const project of projects) upsert.run({ ...project, ...project.binding })
        db.prepare(`DELETE FROM learning_words_cache WHERE course_id=? AND NOT EXISTS
          (SELECT 1 FROM learning_projects_cache p WHERE p.course_id=learning_words_cache.course_id AND p.root_rel_path=learning_words_cache.root_rel_path)`).run(courseId)
      })()
    },
    index(snapshot: LearningProjectSnapshot) {
      db.transaction(() => {
        upsert.run({ ...snapshot, ...snapshot.binding })
        removeWords.run(snapshot.binding.courseId, snapshot.binding.rootRelPath)
        for (const word of snapshot.words) insertWord.run(snapshot.binding.courseId, snapshot.binding.rootRelPath, word.id, word.surface, word.meaning, word.status)
      })()
    }
  }
}
