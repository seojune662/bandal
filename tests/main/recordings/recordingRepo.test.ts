import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createTestDb, type TestDb } from '../helpers/testDb'
import {
  createRecordingRepo,
  type RecordingRepo
} from '../../../src/main/features/recordings/recordingRepo'

describe('durable lecture recordings', () => {
  let testDb: TestDb
  let repo: RecordingRepo
  let folder: string
  beforeEach(() => {
    testDb = createTestDb()
    folder = join(testDb.dir, 'course')
    mkdirSync(folder)
    repo = createRecordingRepo(testDb.db, (id) => {
      if (id !== 'course') throw new Error('unknown course')
      return folder
    })
  })
  afterEach(() => testDb.cleanup())
  function recording() {
    const session = repo.create('course', '한국어 강의', 'zipformer-ko')
    return repo.save({ ...session, status: 'recording' })
  }
  it('acknowledges PCM once, rejects sequence gaps, and leaves a playable WAV', () => {
    const session = recording()
    const pcm = new Uint8Array([0, 0, 255, 127, 0, 128])
    const saved = repo.append(session.id, 0, pcm)
    expect(saved.samples).toBe(3)
    expect(repo.append(session.id, 0, pcm).samples).toBe(3)
    expect(() => repo.append(session.id, 2, pcm)).toThrow('순서')
    const wave = readFileSync(join(folder, session.audioRelPath))
    expect(wave.subarray(0, 4).toString()).toBe('RIFF')
    expect(wave.readUInt32LE(40)).toBe(6)
    expect(wave.length).toBe(50)
    expect([...repo.readAudio(saved, 0, 3)]).toEqual([0, 32767 / 32768, -1])
  })
  it.each(['recording', 'interrupted'] as const)(
    'recovers %s audio written before metadata commit and repairs a partial sample/header',
    (status) => {
      const session = recording()
      repo.append(session.id, 0, new Uint8Array(16000))
      appendFileSync(join(folder, session.audioRelPath), new Uint8Array(1001))
      repo.save({ ...repo.get(session.id), status })
      repo.recover()
      const recovered = repo.get(session.id)
      expect(recovered.status).toBe('interrupted')
      expect(recovered.samples).toBe(8500)
      const bytes = readFileSync(join(folder, session.audioRelPath))
      expect(bytes.length).toBe(17044)
      expect(bytes.readUInt32LE(40)).toBe(17000)
      expect(() => repo.append(session.id, 1, new Uint8Array(2))).toThrow('진행 중')
    }
  )
  it('blocks malformed chunks and material path escapes', () => {
    const session = recording()
    expect(() => repo.append(session.id, 0, new Uint8Array(3))).toThrow('청크')
    expect(() => repo.append(session.id, 0, new Uint8Array(32002))).toThrow('청크')
    expect(() => repo.anchor(session.id, 'bad', '../outside.md')).toThrow()
    expect(() => repo.create('course', 'test', 'bad' as never)).toThrow('모델')
  })
  it('resolves existing WAV files by course and survives folder renames', () => {
    const session = recording()
    expect(repo.resolve('course', session.audioRelPath)?.id).toBe(session.id)
    expect(repo.resolve('course', 'unrelated.wav')).toBeNull()
    expect(() => repo.resolve('missing-course', session.audioRelPath)).toThrow()
    expect(() => repo.resolve('course', '../outside.wav')).toThrow()
    renameSync(join(folder, '녹음'), join(folder, '강의 녹음'))
    repo.repoint('course', '녹음', '강의 녹음', true)
    expect(repo.resolve('course', session.audioRelPath.replace('녹음/', '강의 녹음/'))?.id).toBe(session.id)
  })
  it('rejects symlinked recording roots outside the course', () => {
    symlinkSync(testDb.dir, join(folder, '녹음'))
    expect(() => repo.create('course', 'test', 'zipformer-ko')).toThrow()
  })
  it('keeps the UI page bounded while exporting every segment in order', () => {
    const session = recording()
    for (let i = 0; i < 450; i++)
      repo.addSegment(session.id, i * 16000, (i + 1) * 16000, `문장 ${i}`)
    const latest = repo.read(session.id)
    expect(latest.segments).toHaveLength(200)
    expect(latest.segments[0]?.text).toBe('문장 250')
    const first = repo.read(session.id, 0)
    expect(first.segments[0]?.text).toBe('문장 0')
    const markdown = repo.markdown(session.id)
    expect(markdown).toContain('문장 0\n')
    expect(markdown).toContain('문장 449\n')
    expect(markdown.indexOf('문장 0\n')).toBeLessThan(markdown.indexOf('문장 449\n'))
  })
  it('follows material and recording folder renames without changing anchor times', () => {
    const session = recording()
    repo.append(session.id, 0, new Uint8Array(16000))
    writeFileSync(join(folder, '필기.md'), '# original')
    repo.anchor(session.id, '중요', '필기.md', undefined, 4000)
    renameSync(join(folder, '필기.md'), join(folder, '수정한 필기.md'))
    repo.repoint('course', '필기.md', '수정한 필기.md', false)
    renameSync(join(folder, '녹음'), join(folder, '지난 녹음'))
    repo.repoint('course', '녹음', '지난 녹음', true)
    const detail = repo.read(session.id)
    expect(detail.anchors[0]?.relPath).toBe('수정한 필기.md')
    expect(detail.anchors[0]?.sample).toBe(4000)
    expect(detail.session.audioRelPath).toMatch(/^지난 녹음\//)
    expect(repo.readAudio(detail.session, 0, 8000)).toHaveLength(8000)
  })
})
