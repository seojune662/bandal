import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWhisperEngine } from '../../../src/main/features/recordings/whisperEngine'
import type { EngineResult } from '../../../src/main/features/recordings/engineProtocol'

const directory = process.env['BANDAL_WHISPER_MODEL_DIR']
const input = process.env['BANDAL_WHISPER_WAV']
// User-supplied recordings remain local, outside version control. Opt in only.
it.skipIf(!directory || !input)(
  'transcribes a real local lecture through the live Whisper engine',
  async () => {
    const native = require('sherpa-onnx-node') as {
      readWave(path: string): { samples: Float32Array; sampleRate: number }
    }
    const wave = native.readWave(input!)
    expect(wave.sampleRate).toBe(16000)
    const limit = Number(process.env['BANDAL_WHISPER_SECONDS'] ?? Infinity) * 16000
    const samples = wave.samples.subarray(0, Math.min(wave.samples.length, limit))
    const startLoad = performance.now()
    const engine = await createWhisperEngine(directory!)
    const loadMs = performance.now() - startLoad
    const segments: EngineResult['segments'] = []
    let previews = 0
    let previousPreview = ''
    let peakRss = process.memoryUsage().rss
    const durations: number[] = []
    const started = performance.now()
    let received = 0
    let lastEnd = 0
    const check = (result: EngineResult) => {
      for (const segment of result.segments) {
        expect(segment.startSample).toBeGreaterThanOrEqual(lastEnd)
        expect(segment.endSample).toBeGreaterThan(segment.startSample)
        expect(segment.endSample).toBeLessThanOrEqual(received)
        lastEnd = segment.endSample
        segments.push(segment)
      }
      if (result.partial && result.partial.text !== previousPreview) previews++
      previousPreview = result.partial?.text ?? ''
    }
    try {
      for (let offset = 0; offset < samples.length; offset += 8000) {
        const chunk = samples.subarray(offset, offset + 8000)
        received += chunk.length
        const before = performance.now()
        check(await engine.accept(chunk))
        durations.push(performance.now() - before)
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
        if (offset % (16000 * 60) === 0)
          console.log('Whisper live pipeline audio seconds:', offset / 16000)
      }
      check(await engine.flush())
      const elapsedMs = performance.now() - started
      expect(segments.length).toBeGreaterThan(0)
      expect(segments.map((s) => s.text).join(' ')).toMatch(/[가-힣]/)
      const report = {
        loadMs,
        elapsedMs,
        audioSeconds: samples.length / 16000,
        rtf: elapsedMs / (samples.length / 16),
        peakRss,
        previews,
        maxChunkMs: Math.max(...durations),
        segments
      }
      await writeFile(join(directory!, 'live-benchmark.json'), JSON.stringify(report, null, 2), {
        mode: 0o600
      })
      console.log(JSON.stringify({ ...report, segments: segments.length }, null, 2))
      // Verify silence after real speech doesn't recycle prior-context text.
      for (let i = 0; i < 120; i++)
        expect(await engine.accept(new Float32Array(8000))).toEqual({
          segments: [],
          partial: null
        })
      expect(await engine.flush()).toEqual({ segments: [], partial: null })
    } finally {
      await engine.dispose()
    }
  },
  30 * 60 * 1000
)
