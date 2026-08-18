import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  backupMaterial,
  materialEditTargetId,
  parseMaterialEditTargetId,
  restoreMaterialBackup
} from '../../../src/main/features/agentTools/documentBackup'

const BACKUP_DIR = join('.bandal', 'backups')

describe('documentBackup', () => {
  let courseFolder: string

  beforeEach(() => {
    courseFolder = mkdtempSync(join(tmpdir(), 'bandal-backup-'))
  })

  afterEach(() => {
    rmSync(courseFolder, { recursive: true, force: true })
  })

  test('copies the original bytes into the hidden backup directory', () => {
    const source = join(courseFolder, '성적.xlsx')
    writeFileSync(source, Buffer.from([1, 2, 3, 4]))

    const backup = backupMaterial(courseFolder, source)

    expect(backup.backupAbs.startsWith(join(courseFolder, BACKUP_DIR))).toBe(true)
    expect(backup.backupName.endsWith('-성적.xlsx')).toBe(true)
    expect(readFileSync(backup.backupAbs)).toEqual(Buffer.from([1, 2, 3, 4]))
    // 원본은 그대로 남는다.
    expect(readFileSync(source)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  test('never reuses a backup name for back-to-back backups of the same file', () => {
    const source = join(courseFolder, '보고서.docx')
    writeFileSync(source, 'v1', 'utf8')
    const first = backupMaterial(courseFolder, source)
    writeFileSync(source, 'v2', 'utf8')
    const second = backupMaterial(courseFolder, source)

    expect(second.backupAbs).not.toBe(first.backupAbs)
    expect(readFileSync(first.backupAbs, 'utf8')).toBe('v1')
    expect(readFileSync(second.backupAbs, 'utf8')).toBe('v2')
  })

  test('prunes the oldest backups beyond the keep limit', () => {
    const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']
    for (const name of names) {
      const source = join(courseFolder, name)
      writeFileSync(source, name, 'utf8')
      backupMaterial(courseFolder, source, 3)
    }

    const kept = readdirSync(join(courseFolder, BACKUP_DIR)).sort()
    expect(kept).toHaveLength(3)
    expect(kept.map((name) => name.slice(-5))).toEqual(['c.txt', 'd.txt', 'e.txt'])
  })

  test('round-trips relPath and backupAbs through the journal targetId', () => {
    const targetId = materialEditTargetId('폴더/성적.xlsx', '/tmp/backups/성적.xlsx')

    expect(parseMaterialEditTargetId(targetId)).toEqual({
      relPath: '폴더/성적.xlsx',
      backupAbs: '/tmp/backups/성적.xlsx'
    })
    expect(parseMaterialEditTargetId('no-separator')).toBeNull()
  })

  test('restore copies the backup over the original path', () => {
    const source = join(courseFolder, '자료.txt')
    writeFileSync(source, 'original', 'utf8')
    const backup = backupMaterial(courseFolder, source)
    writeFileSync(source, 'edited', 'utf8')

    restoreMaterialBackup({
      courseFolder,
      relPath: '자료.txt',
      backupAbs: backup.backupAbs
    })

    expect(readFileSync(source, 'utf8')).toBe('original')
  })

  test('restore recreates the file at the original path after a rename', () => {
    const source = join(courseFolder, '자료.txt')
    writeFileSync(source, 'original', 'utf8')
    const backup = backupMaterial(courseFolder, source)
    rmSync(source)

    restoreMaterialBackup({
      courseFolder,
      relPath: '자료.txt',
      backupAbs: backup.backupAbs
    })

    expect(readFileSync(source, 'utf8')).toBe('original')
  })

  test('restore throws instead of silently succeeding when the backup is gone', () => {
    const missing = join(courseFolder, BACKUP_DIR, 'nope.txt')
    expect(existsSync(missing)).toBe(false)

    expect(() =>
      restoreMaterialBackup({
        courseFolder,
        relPath: '자료.txt',
        backupAbs: missing
      })
    ).toThrow('되돌릴 수 없습니다')
  })
})
