import { describe, expect, it, vi } from 'vitest'
import { createWhisperStream } from '../../../src/main/features/recordings/whisperEngine'
import { DEFAULT_SPEECH_MODEL } from '../../../src/shared/recording'
import { speechModel } from '../../../src/main/features/recordings/modelCatalog'
import { speechUnavailableReason } from '../../../src/main/features/recordings/speechCompatibility'

function detector() {
  let detected = false
  const queue: { start: number; samples: Float32Array }[] = []
  return {
    acceptWaveform: vi.fn(),
    isDetected: () => detected,
    isEmpty: () => queue.length === 0,
    front: () => queue[0]!,
    pop: () => {
      queue.shift()
    },
    flush: vi.fn(),
    reset: vi.fn(() => {
      detected = false
    }),
    speech: () => {
      detected = true
    },
    end: (start: number, seconds: number) => {
      detected = false
      queue.push({ start, samples: new Float32Array(seconds * 16000) })
    }
  }
}
const output = (text = '벡터의 외적입니다.', t0 = 0, t1 = 1000) => ({
  result: text,
  isAborted: false,
  segments: [{ text, t0, t1 }]
})

describe('large-v3-turbo lecture stream', () => {
  it('blocks incompatible native macOS builds without substituting a model', () => {
    expect(speechUnavailableReason('whisper-large-v3-turbo', 'darwin', '23.6.0')).toContain(
      'macOS 15'
    )
    expect(speechUnavailableReason('whisper-large-v3-turbo', 'darwin', '24.0.0')).toBeUndefined()
    expect(speechUnavailableReason('zipformer-ko', 'darwin', '23.6.0')).toBeUndefined()
    expect(speechUnavailableReason('whisper-large-v3-turbo', 'win32', '10.0')).toBeUndefined()
  })
  it('pins the explicitly requested FP16 model as the default', () => {
    const model = speechModel(DEFAULT_SPEECH_MODEL)
    expect(model.id).toBe('whisper-large-v3-turbo')
    expect(model.files[0]?.name).toBe('ggml-large-v3-turbo.bin')
    expect(model.files[0]?.bytes).toBe(1624555275)
    expect(model.revision).toMatch(/^[a-f0-9]{40}$/)
    expect(model.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  })
  it('does not run Whisper on silence and feeds exact 512-sample VAD frames', async () => {
    const vad = detector()
    const decode = vi.fn(async (_samples: Float32Array) => output())
    const engine = createWhisperStream(vad, decode)
    for (let i = 0; i < 120; i++) {
      expect(await engine.accept(new Float32Array(8000))).toEqual({
        segments: [],
        partial: null
      })
    }
    await engine.flush()
    expect(decode).not.toHaveBeenCalled()
    expect(vad.acceptWaveform.mock.calls.every(([frame]) => frame.length === 512)).toBe(true)
  })
  it('keeps previews stable between decodes, bounds windows and clears them at an endpoint', async () => {
    const vad = detector()
    const decode = vi.fn(async (_samples: Float32Array) => output())
    const engine = createWhisperStream(vad, decode)
    vad.speech()
    let result = await engine.accept(new Float32Array(80000))
    expect(result.partial?.text).toBe('벡터의 외적입니다.')
    const calls = decode.mock.calls.length
    expect((await engine.accept(new Float32Array(8000))).partial).toEqual(result.partial)
    expect(decode).toHaveBeenCalledTimes(calls)
    // Even a malfunctioning VAD cannot grow the preview audio without bound.
    for (let i = 0; i < 80; i++) await engine.accept(new Float32Array(8000))
    expect(decode.mock.calls.every(([samples]) => samples.length <= 30 * 16000)).toBe(true)
    vad.end(0, 24)
    await engine.accept(new Float32Array(8000))
    result = await engine.flush()
    expect(result.partial).toBeNull()
    expect(result.segments.length).toBeGreaterThan(0)
  })
  it('converts binding milliseconds, clips padding and preserves the clock across pause/resume', async () => {
    const vad = detector()
    const decode = vi.fn(async () => output('첫 문장', 100, 9000))
    const engine = createWhisperStream(vad, decode)
    await engine.accept(new Float32Array(16000))
    vad.end(1600, 1)
    const first = await engine.flush()
    expect(first.segments).toEqual([{ startSample: 3200, endSample: 16000, text: '첫 문장' }])
    await engine.accept(new Float32Array(16000))
    vad.end(0, 1)
    expect((await engine.flush()).segments).toEqual([
      { startSample: 17600, endSample: 32000, text: '첫 문장' }
    ])
  })
  it('does not treat an aborted native decode as completed transcription', async () => {
    const vad = detector()
    const engine = createWhisperStream(vad, async () => ({
      ...output(),
      isAborted: true
    }))
    await engine.accept(new Float32Array(16000))
    vad.end(0, 1)
    await expect(engine.flush()).rejects.toThrow('중단')
  })
  it('retains audible intro when VAD only recognizes speech six seconds later', async () => {
    const vad = detector()
    const decode = vi.fn(async (_samples: Float32Array) => output('벡터의 곱셈', 0, 8000))
    const engine = createWhisperStream(vad, decode)
    await engine.accept(new Float32Array(16000 * 6).fill(0.02))
    expect(decode).not.toHaveBeenCalled()
    vad.speech()
    await engine.accept(new Float32Array(16000 * 2).fill(0.02))
    expect((await engine.flush()).segments[0]).toEqual({
      startSample: 0,
      endSample: 128000,
      text: '벡터의 곱셈'
    })
    expect(decode.mock.calls.at(-1)![0].length).toBe(128000)
  })
  it('does not turn audible background noise without VAD evidence into captions', async () => {
    const vad = detector()
    const decode = vi.fn(async (_samples: Float32Array) => output())
    const engine = createWhisperStream(vad, decode)
    for (let i = 0; i < 120; i++) await engine.accept(new Float32Array(8000).fill(0.02))
    expect(await engine.flush()).toEqual({ segments: [], partial: null })
    expect(decode).not.toHaveBeenCalled()
  })
  it('skips speculative decoding while catching up but still finalizes the audio', async () => {
    const vad = detector()
    const decode = vi.fn(async (_samples: Float32Array) => output())
    const engine = createWhisperStream(vad, decode)
    vad.speech()
    await engine.accept(new Float32Array(16000 * 5).fill(0.02), false)
    expect(decode).not.toHaveBeenCalled()
    expect((await engine.flush()).segments.length).toBe(1)
  })
})
