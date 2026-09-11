import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createModelManager } from '../../../src/main/features/recordings/modelManager'
import { createSpeechEngine } from '../../../src/main/features/recordings/speechEngine'
import type { EngineResult } from '../../../src/main/features/recordings/engineProtocol'

// Explicit opt-in: ordinary tests do not download models or consume CPU for a
// benchmark. The directory is also usable as an isolated E2E model cache.
const root = process.env['BANDAL_STT_BENCHMARK_DIR']
it.skipIf(!root)(
  'runs the real native models on Korean speech and sustained input',
  async () => {
    const manager = createModelManager(root!, () => undefined)
    const report: unknown[] = []
    const source =
      'https://huggingface.co/k2-fsa/sherpa-onnx-streaming-zipformer-korean-2024-06-16/resolve/ba6078bca4daf3f0dd37f79d0ab505af71df14a6/test_wavs/0.wav'
    const response = await fetch(source)
    expect(response.ok).toBe(true)
    const wav = Buffer.from(await response.arrayBuffer())
    const wavPath = join(root!, 'korean.wav')
    await writeFile(wavPath, wav)
    const native = require('sherpa-onnx-node') as {
      readWave(path: string): { sampleRate: number; samples: Float32Array }
    }
    const wave = native.readWave(wavPath)
    expect(wave.sampleRate).toBe(16000)
    for (const id of ['zipformer-ko', 'sensevoice'] as const) {
      await manager.download(id)
      const directory = await manager.verify(id)
      const before = performance.now()
      const engine = createSpeechEngine(id, directory)
      const loadMs = performance.now() - before
      const texts: string[] = []
      const start = performance.now()
      for (let offset = 0; offset < wave.samples.length; offset += 8000)
        texts.push(
          ...engine
            .accept(wave.samples.slice(offset, offset + 8000))
            .segments.map((segment) => segment.text)
        )
      for (let i = 0; i < 4; i++)
        texts.push(...engine.accept(new Float32Array(8000)).segments.map((segment) => segment.text))
      texts.push(...engine.flush().segments.map((segment) => segment.text))
      const elapsedMs = performance.now() - start
      console.log('Native transcript', id, texts)
      expect(texts.join(''), id).toMatch(/[가-힣]/)
      const initialRss = process.memoryUsage().rss
      const minutes = Number(process.env['BANDAL_STT_STRESS_MINUTES'] ?? '2')
      const silence = new Float32Array(8000)
      const loops = Math.ceil((minutes * 60) / (wave.samples.length / 16000 + 2))
      const stressStart = performance.now()
      let audioSeconds = 0
      let peakRss = initialRss
      for (let repeat = 0; repeat < loops; repeat++) {
        for (let offset = 0; offset < wave.samples.length; offset += 8000)
          engine.accept(wave.samples.slice(offset, offset + 8000))
        for (let i = 0; i < 4; i++) engine.accept(silence)
        audioSeconds += wave.samples.length / 16000 + 2
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
        // Let V8 collect wrappers/native handles between utterances.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      engine.flush()
      report.push({
        id,
        source,
        text: texts.join(' '),
        loadMs,
        elapsedMs,
        clipSeconds: wave.samples.length / 16000,
        stressAudioSeconds: audioSeconds,
        stressWallMs: performance.now() - stressStart,
        initialRss,
        peakRss,
        finalRss: process.memoryUsage().rss,
        hardware: process.arch
      })
    }
    await writeFile(join(root!, 'benchmark.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  },
  15 * 60 * 1000
)

it.skipIf(!root)(
  'handles silence and sustained speech with bounded, monotonic segment times',
  async () => {
    const manager = createModelManager(root!, () => undefined)
    const native = require('sherpa-onnx-node') as {
      readWave(path: string): { samples: Float32Array }
    }
    // Run the benchmark above once to populate this explicit fixture cache.
    const wave = native.readWave(join(root!, 'korean.wav'))
    for (const id of ['zipformer-ko', 'sensevoice'] as const) {
      const engine = createSpeechEngine(id, await manager.verify(id))
      for (let i = 0; i < 120; i++) {
        const quiet = engine.accept(new Float32Array(8000))
        expect(quiet.segments, `${id}: silence must not hallucinate`).toHaveLength(0)
        expect(quiet.partial).toBeNull()
      }
      expect(engine.flush().segments).toHaveLength(0)
      let received = 60 * 16000
      let lastEnd = 0
      let finalized = 0
      function check(result: EngineResult) {
        for (const segment of result.segments) {
          expect(segment.startSample).toBeGreaterThanOrEqual(lastEnd)
          expect(segment.endSample).toBeGreaterThan(segment.startSample)
          expect(segment.endSample).toBeLessThanOrEqual(received)
          lastEnd = segment.endSample
          finalized++
        }
      }
      for (let i = 0; i < 36; i++) {
        for (let offset = 0; offset < wave.samples.length; offset += 8000) {
          const chunk = wave.samples.slice(offset, offset + 8000)
          received += chunk.length
          check(engine.accept(chunk))
        }
      }
      check(engine.flush())
      expect(finalized, `${id}: long input must not remain one growing utterance`).toBeGreaterThan(
        1
      )
    }
  },
  60_000
)
