// Local-only opt-in benchmark. Never upload audio or put lecture data in git.
// node scripts/benchmark-whisper.mjs MODEL WAV OUTPUT_DIRECTORY
// node scripts/benchmark-whisper.mjs --render TRANSCRIPT_JSON OUTPUT_DIRECTORY
// node scripts/benchmark-whisper.mjs --render-live LIVE_BENCHMARK_JSON OUTPUT_DIRECTORY
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import whisper from '@fugood/whisper.node'

const [model, wav, output] = process.argv.slice(2)
if (!model || !wav || !output) throw new Error('Expected MODEL WAV OUTPUT_DIRECTORY')
await mkdir(output, { recursive: true, mode: 0o700 })
const started = performance.now()
let replay = model.startsWith('--render') ? JSON.parse(await readFile(wav, 'utf8')) : null
if (model === '--render-live') {
  const { segments, ...stats } = replay
  replay = {
    stats: {
      ...stats,
      model: 'large-v3-turbo FP16',
      mode: 'live-pipeline',
      segments: segments.length
    },
    isAborted: false,
    result: segments.map((segment) => segment.text).join(' '),
    segments: segments.map((segment) => ({
      text: segment.text,
      t0: segment.startSample / 16,
      t1: segment.endSample / 16
    }))
  }
}
const context = replay
  ? null
  : await whisper.initWhisper({
      filePath: model,
      useGpu: process.platform === 'darwin' && process.arch === 'arm64',
      useFlashAttn: true
    })
const loadMs = performance.now() - started
let peakRss = process.memoryUsage().rss
const meter = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
}, 100)
try {
  const before = performance.now()
  const result =
    replay ??
    (await context.transcribeFile(wav, {
      language: 'ko',
      translate: false,
      maxThreads: 2,
      maxContext: 0,
      temperature: 0,
      temperatureInc: 0,
      bestOf: 1,
      onProgress: (percent) => console.log('Transcribing locally:', percent, '%')
    }).promise)
  if (result.isAborted) throw new Error('Transcription was aborted')
  const stats = replay?.stats ?? {
    model: 'large-v3-turbo FP16',
    loadMs,
    elapsedMs: performance.now() - before,
    peakRss,
    arch: process.arch,
    options: context.getModelInfo(),
    segments: result.segments.length
  }
  // whisper.node converts the native centiseconds to milliseconds.
  const time = (t, srt = false) => {
    const ms = Math.round(t)
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
    const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0')
    const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
    return `${h}:${m}:${s}${srt ? ',' + String(ms % 1000).padStart(3, '0') : ''}`
  }
  await writeFile(join(output, 'transcript.json'), JSON.stringify({ stats, ...result }, null, 2), {
    mode: 0o600
  })
  await writeFile(
    join(output, 'transcript.md'),
    '# 강의 전사 — large-v3-turbo\n\n자동 전사 초안입니다. 수식·전문용어는 원음과 대조해 주세요.\n\n' +
      result.segments.map((s) => `**${time(s.t0)}** ${s.text.trim()}\n`).join('\n'),
    { mode: 0o600 }
  )
  await writeFile(
    join(output, 'transcript.srt'),
    result.segments
      .map((s, i) => `${i + 1}\n${time(s.t0, true)} --> ${time(s.t1, true)}\n${s.text.trim()}\n`)
      .join('\n'),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(stats, null, 2))
} finally {
  clearInterval(meter)
  await context?.release()
}
