import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createTestDb, type TestDb } from '../helpers/testDb'
import {
  createRecordingRepo,
  type RecordingRepo
} from '../../../src/main/features/recordings/recordingRepo'
import { createRecordingService } from '../../../src/main/features/recordings/recordingService'
import type { EngineResult } from '../../../src/main/features/recordings/engineProtocol'

const mock = vi.hoisted(() => ({
  request: vi.fn(),
  dispose: vi.fn(),
  verify: vi.fn(),
  emit: vi.fn(),
  stop: vi.fn()
}))
vi.mock('electron', () => ({
  powerSaveBlocker: { start: () => 1, stop: mock.stop, isStarted: () => true }
}))
vi.mock('../../../src/main/features/recordings/engineClient', () => ({
  createEngineClient: () => ({ request: mock.request, dispose: mock.dispose })
}))
const result = (): { result: EngineResult; elapsedMs: number } => ({
  result: { segments: [], partial: null },
  elapsedMs: 10
})

describe('recording scheduler', () => {
  let db: TestDb
  let repo: RecordingRepo
  let service: ReturnType<typeof createRecordingService>
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mock.request.mockImplementation(async () => result())
    mock.verify.mockResolvedValue('/verified/model')
    db = createTestDb()
    const folder = join(db.dir, 'course')
    mkdirSync(folder)
    repo = createRecordingRepo(db.db, () => folder)
    service = createRecordingService({
      repo,
      models: { verify: mock.verify, dispose: vi.fn() } as never,
      hostEntry: '/host.js',
      emit: mock.emit
    })
  })
  afterEach(() => {
    service.dispose()
    db.cleanup()
    vi.useRealTimers()
  })
  async function start() {
    const session = repo.create('course', 'Lecture', 'zipformer-ko')
    await service.control(session.id, 'start')
    return session
  }
  it('spools backlog to disk with only one inference request, then drains before completing', async () => {
    const session = await start()
    let finish!: (value: ReturnType<typeof result>) => void
    mock.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    service.append(session.id, 0, new Uint8Array(16000))
    await vi.advanceTimersByTimeAsync(20)
    for (let i = 1; i < 80; i++) service.append(session.id, i, new Uint8Array(16000))
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.request).toHaveBeenCalledTimes(2) // init + one outstanding chunk
    expect(repo.get(session.id).samples).toBe(640000)
    expect(repo.get(session.id).transcribedSamples).toBe(0)
    await service.control(session.id, 'stop')
    expect(repo.get(session.id).status).toBe('processing')
    finish(result())
    await vi.advanceTimersByTimeAsync(2000)
    expect(repo.get(session.id).status).toBe('complete')
    expect(repo.get(session.id).transcribedSamples).toBe(640000)
    expect(mock.request.mock.calls.filter(([request]) => request.type === 'audio')).toHaveLength(80)
    expect(mock.request.mock.calls.at(-1)?.[0].type).toBe('flush')
  })
  it('keeps accepting audio after an inference crash and permits recovery with a different model', async () => {
    const session = await start()
    mock.request.mockRejectedValueOnce(new Error('engine crashed'))
    service.append(session.id, 0, new Uint8Array(16000))
    await vi.advanceTimersByTimeAsync(20)
    expect(repo.get(session.id).status).toBe('recording')
    service.append(session.id, 1, new Uint8Array(16000))
    expect(repo.get(session.id).samples).toBe(16000)
    await service.control(session.id, 'stop')
    expect(repo.get(session.id).status).toBe('interrupted')
    await service.control(session.id, 'retry', 'sensevoice')
    await vi.advanceTimersByTimeAsync(100)
    expect(repo.get(session.id).status).toBe('complete')
    expect(repo.get(session.id).modelId).toBe('sensevoice')
    expect(mock.verify).toHaveBeenLastCalledWith('sensevoice')
  })
  it('defers inference in critical thermal state while saving audio, and catches up when cool', async () => {
    const session = await start()
    service.setThermalState('critical')
    service.append(session.id, 0, new Uint8Array(16000))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mock.request).toHaveBeenCalledTimes(1)
    expect(repo.get(session.id).samples).toBe(8000)
    service.setThermalState('nominal')
    await service.control(session.id, 'stop')
    await vi.advanceTimersByTimeAsync(3000)
    expect(repo.get(session.id).status).toBe('complete')
  })
  it('detects missing capture input without treating an intentional pause as a failure', async () => {
    const session = await start()
    await service.control(session.id, 'pause')
    await vi.advanceTimersByTimeAsync(20000)
    expect(repo.get(session.id).status).toBe('paused')
    await service.control(session.id, 'start')
    await vi.advanceTimersByTimeAsync(20000)
    expect(repo.get(session.id).status).toBe('interrupted')
    expect(mock.stop).toHaveBeenCalled()
  })
  it('releases a prepared engine if recording state cannot be committed, leaving start retryable', async () => {
    const session = repo.create('course', 'Lecture', 'zipformer-ko')
    const save = vi.spyOn(repo, 'save').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await expect(service.control(session.id, 'start')).rejects.toThrow('disk full')
    expect(service.getActiveSession()).toBeNull()
    expect(mock.stop).toHaveBeenCalled()
    save.mockRestore()
    await service.control(session.id, 'start')
    expect(service.getActiveSession()?.status).toBe('recording')
  })
  it('interrupts safely even if persisting the error also fails, then recovers on restart', async () => {
    const session = await start()
    service.append(session.id, 0, new Uint8Array(16000))
    mock.request.mockRejectedValueOnce(new Error('worker stopped'))
    const save = vi.spyOn(repo, 'save').mockImplementation(() => {
      throw new Error('disk full')
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(service.getActiveSession()).toBeNull()
    expect(mock.emit.mock.calls.at(-1)?.[0].session).toMatchObject({
      status: 'interrupted',
      samples: 8000
    })
    expect(mock.emit.mock.calls.at(-1)?.[0].session.error).toContain('상태도 저장하지 못했습니다')
    save.mockRestore()
    repo.recover()
    expect(repo.get(session.id)).toMatchObject({ status: 'interrupted', samples: 8000 })
  })
})
