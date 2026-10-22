import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { wavHeader } from '../src/main/features/recordings/recordingRepo'
import { createCourse, launchBandal } from './helpers/launch'

test('whiteboard and recorded transcript sharing create only the chosen output and cancel cleanly', async () => {
  const bandal = await launchBandal()
  const { page } = bandal
  const destination = async (filePath: string | null) => {
    await bandal.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: filePath === null, ...(filePath ? { filePath } : {}) })
    }, filePath)
  }
  try {
    await createCourse(page, '외부 자료 공유')
    const fixture = await page.evaluate(async () => {
      const course = (await window.bandal.invoke('courses:list', {}))[0]!
      const board = await window.bandal.invoke('canvas:create', { courseId: course.id, title: '필기 보드' })
      await window.bandal.invoke('canvas:putShape', { boardId: board.id, id: 'share-shape', shape: {
        kind: 'rect', data: { box: { x: .1, y: .1, width: .3, height: .2 } }, style: { color: 'blue', width: .004, opacity: 1 }
      } })
      const recording = await window.bandal.invoke('recordings:create', { courseId: course.id, title: '공유 강의', modelId: 'whisper-large-v3-turbo' })
      return { course, board, recording }
    })
    // A deterministic saved lecture fixture needs no microphone or STT model.
    const Database = require('better-sqlite3-node') as typeof import('better-sqlite3')
    const db = new Database(join(bandal.userDataDir, 'bandal.db'))
    const samples = 16000
    const audio = Buffer.concat([wavHeader(samples), Buffer.alloc(samples * 2)])
    writeFileSync(join(fixture.course.folderPath, fixture.recording.audioRelPath), audio)
    try {
      db.prepare('UPDATE recording_sessions SET payload = ? WHERE id = ?').run(JSON.stringify({ ...fixture.recording, status: 'complete', samples, transcribedSamples: samples }), fixture.recording.id)
      db.prepare('INSERT INTO recording_segments (session_id, start_sample, end_sample, text) VALUES (?, ?, ?, ?)').run(fixture.recording.id, 0, samples, '밖으로 공유할 최신 강의 자막')
    } finally { db.close() }
    const courseFiles = () => readdirSync(fixture.course.folderPath, { recursive: true }).map(String).sort()
    const originalFiles = courseFiles()
    await destination(null)
    const canceled = await page.evaluate(async ({ board, recording }) => [
      await window.bandal.invoke('canvas:sharePdf', { boardId: board.id }),
      await window.bandal.invoke('recordings:shareTranscript', { id: recording.id })
    ], fixture)
    expect(canceled).toEqual([{ savedPath: null }, { savedPath: null }])
    expect(courseFiles()).toEqual(originalFiles)

    const pdfPath = join(bandal.profileDir, 'shared-board.pdf')
    await destination(pdfPath)
    expect(await page.evaluate(boardId => window.bandal.invoke('canvas:sharePdf', { boardId }), fixture.board.id)).toEqual({ savedPath: pdfPath })
    expect((await PDFDocument.load(readFileSync(pdfPath))).getPageCount()).toBe(1)

    const markdownPath = join(bandal.profileDir, 'shared-transcript.md')
    await destination(markdownPath)
    expect(await page.evaluate(id => window.bandal.invoke('recordings:shareTranscript', { id }), fixture.recording.id)).toEqual({ savedPath: markdownPath })
    expect(readFileSync(markdownPath, 'utf8')).toContain('밖으로 공유할 최신 강의 자막')

    const audioPath = join(bandal.profileDir, 'shared-audio.wav')
    await destination(audioPath)
    await page.evaluate(({ course, recording }) => window.bandal.invoke('materials:export', { courseId: course.id, relPath: recording.audioRelPath }), fixture)
    expect(readFileSync(audioPath)).toEqual(audio)
    expect(courseFiles()).toEqual(originalFiles)
  } finally { await bandal.close() }
})
