// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordingSession } from '../../../src/shared/recording'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn() }))
import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  abandonCapture,
  pauseCapture,
  startCapture,
  stopCapture,
  useCaptureStore
} from '../../../src/renderer/src/features/recordings/captureStore'

const ipc = vi.mocked(invoke)
const sessions = new Map<string, RecordingSession>()
const worklets: FakeWorklet[] = []
const tracks: Array<{
  onended: (() => void) | null
  stop: ReturnType<typeof vi.fn>
  enabled: boolean
}> = []
class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeContext {
  sampleRate = 16000
  destination = {}
  audioWorklet = { addModule: vi.fn(async () => undefined) }
  resume = vi.fn(async () => undefined)
  suspend = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createMediaStreamSource() {
    return new FakeNode()
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: { value: 1 } })
  }
}
class FakeWorklet extends FakeNode {
  port = {
    onmessage: null as
      | ((event: { data: { pcm?: ArrayBuffer; level?: number; flushed?: boolean } }) => void)
      | null,
    close: vi.fn(),
    postMessage: vi.fn((message: string) => {
      if (message === 'pause')
        queueMicrotask(() => this.port.onmessage?.({ data: { flushed: true } }))
    })
  }
  constructor() {
    super()
    worklets.push(this)
  }
  send() {
    this.port.onmessage?.({ data: { pcm: new ArrayBuffer(16000), level: 0.2 } })
  }
}
function session(id: string): RecordingSession {
  const value: RecordingSession = {
    id,
    courseId: 'course',
    title: '강의',
    modelId: 'zipformer-ko',
    createdAt: '',
    status: 'ready',
    audioRelPath: 'audio.wav',
    samples: 0,
    transcribedSamples: 0,
    nextSequence: 0,
    error: null
  }
  sessions.set(id, value)
  return value
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
beforeEach(() => {
  sessions.clear()
  tracks.length = 0
  worklets.length = 0
  ipc.mockReset()
  useCaptureStore.setState({ session: null, busy: false, level: 0, error: null })
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorklet)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        const track = { onended: null, enabled: true, stop: vi.fn() }
        tracks.push(track)
        return { getTracks: () => [track], getAudioTracks: () => [track] }
      })
    }
  })
  ipc.mockImplementation(async (channel, request: any) => {
    if (channel === 'recordings:control') {
      const next = {
        ...sessions.get(request.id)!,
        status:
          request.action === 'start'
            ? 'recording'
            : request.action === 'pause'
              ? 'paused'
              : 'processing'
      }
      sessions.set(request.id, next as RecordingSession)
      return next as any
    }
    return { samples: (request.sequence + 1) * 8000, nextSequence: request.sequence + 1 } as any
  })
})
afterEach(() => {
  abandonCapture('test cleanup')
  vi.unstubAllGlobals()
})
it('requests microphone access before starting the engine and leaves permission failures retryable', async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    new DOMException('denied', 'NotAllowedError')
  )
  await expect(startCapture(session('a'), 'default')).rejects.toThrow('denied')
  expect(ipc).not.toHaveBeenCalled()
  expect(useCaptureStore.getState()).toMatchObject({ session: null, busy: false })
  await startCapture(sessions.get('a')!, 'default')
  expect(useCaptureStore.getState().session?.id).toBe('a')
})
it('serializes durable audio acknowledgements and flushes before pause/stop', async () => {
  await startCapture(session('a'), 'default')
  worklets[0]!.send()
  worklets[0]!.send()
  await pauseCapture()
  expect(
    ipc.mock.calls
      .filter(([channel]) => channel === 'recordings:append')
      .map(([, request]) => (request as any).sequence)
  ).toEqual([0, 1])
  expect(useCaptureStore.getState().session?.status).toBe('paused')
  expect(tracks[0]!.enabled).toBe(false)
  await pauseCapture()
  expect(tracks[0]!.enabled).toBe(true)
  await stopCapture()
  expect(useCaptureStore.getState().session).toBeNull()
  expect(tracks[0]!.stop).toHaveBeenCalledOnce()
  expect(ipc).toHaveBeenLastCalledWith('recordings:control', { id: 'a', action: 'stop' })
})
it('marks an unplugged microphone as interrupted, never successfully complete', async () => {
  await startCapture(session('a'), 'default')
  tracks[0]!.onended?.()
  await settle()
  expect(ipc).toHaveBeenLastCalledWith('recordings:control', { id: 'a', action: 'interrupt' })
  expect(useCaptureStore.getState().error).toContain('마이크 연결')
  expect(useCaptureStore.getState().session).toBeNull()
})
it('ignores stale audio responses and queued chunks after starting a different capture', async () => {
  await startCapture(session('a'), 'default')
  let rejectOld!: (error: Error) => void
  ipc.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectOld = reject
      })
  )
  worklets[0]!.send()
  worklets[0]!.send()
  await settle()
  abandonCapture('previous engine interrupted')
  await startCapture(session('b'), 'default')
  rejectOld(new Error('old disk error'))
  await settle()
  worklets[1]!.send()
  await settle()
  expect(useCaptureStore.getState()).toMatchObject({
    session: { id: 'b', samples: 8000 },
    error: null
  })
  const appends = ipc.mock.calls.filter(([channel]) => channel === 'recordings:append')
  expect(appends.map(([, request]) => [(request as any).id, (request as any).sequence])).toEqual([
    ['a', 0],
    ['b', 0]
  ])
})
it('stops with an explicit storage error when the bounded ten-second queue fills', async () => {
  await startCapture(session('a'), 'default')
  ipc.mockImplementationOnce(() => new Promise(() => undefined))
  worklets[0]!.send()
  await settle()
  for (let i = 0; i < 20; i++) worklets[0]!.send()
  await settle()
  expect(useCaptureStore.getState().error).toContain('10초')
  expect(ipc).toHaveBeenLastCalledWith('recordings:control', { id: 'a', action: 'interrupt' })
})
