import { expect, test } from '@playwright/test'
import {
  constants,
  copyFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync
} from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

test('large-v3-turbo: real isolated Metal engine, timestamped lecture, export and reload', async () => {
  const directory = process.env['BANDAL_WHISPER_MODEL_DIR']
  const wav = process.env['BANDAL_WHISPER_WAV']
  test.skip(!directory || !wav, 'Requires an explicitly supplied local lecture and model')
  const realtimeSeconds = Number(process.env['BANDAL_WHISPER_REALTIME_SECONDS'] ?? '0')
  test.setTimeout(180_000 + realtimeSeconds * 1000)
  const bandal = await launchBandal({ keepProfileOnClose: true })
  let closed = false
  const runtimeMetrics: unknown[] = []
  const runtimeTimer =
    realtimeSeconds > 0
      ? setInterval(() => {
          void bandal.app
            .evaluate(({ app, powerMonitor, BrowserWindow }) => {
              const window = BrowserWindow.getAllWindows().find((window) =>
                window.webContents.getURL().includes('index.html')
              )
              window?.hide()
              return {
                at: Date.now(),
                thermal: powerMonitor.getCurrentThermalState(),
                hidden: window ? !window.isVisible() : false,
                speech: app
                  .getAppMetrics()
                  .filter((metric) => metric.name === 'Bandal Speech')
                  .map((metric) => ({ cpu: metric.cpu, memory: metric.memory }))
              }
            })
            .then((metric) => runtimeMetrics.push(metric))
            .catch(() => undefined)
        }, 10000)
      : null
  try {
    const target = join(bandal.userDataDir, 'speech-models', 'whisper-large-v3-turbo')
    mkdirSync(target, { recursive: true })
    // This test only reads immutable model weights. Share their inode instead
    // of copying 1.6 GB for each throwaway profile; fall back across volumes.
    for (const file of ['ggml-large-v3-turbo.bin', 'silero_vad.onnx']) {
      try {
        linkSync(join(directory!, file), join(target, file))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        copyFileSync(join(directory!, file), join(target, file), constants.COPYFILE_FICLONE)
      }
    }
    writeFileSync(
      join(target, 'ready.json'),
      JSON.stringify({ revision: '5359861c739e955e79d9a303bcbc70fb988958b1' })
    )
    const native = require('sherpa-onnx-node') as {
      readWave(path: string): { samples: Float32Array }
    }
    const samples = Array.from(
      native.readWave(wav!).samples.subarray(0, 16000 * Math.max(35, realtimeSeconds))
    )
    const { page } = bandal
    await createCourse(page, '로컬 Whisper 검증')
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByRole('option', { name: '녹음 강의 · 실시간 자막' }).click()
    await expect(page.getByRole('radio', { name: 'Whisper large-v3-turbo' })).toBeChecked()
    const id = await page.evaluate(
      async ({ audio, realtime }) => {
        const course = (await window.bandal.invoke('courses:list', {}))[0]!
        const session = await window.bandal.invoke('recordings:create', {
          courseId: course.id,
          title: 'Whisper 강의 검증',
          modelId: 'whisper-large-v3-turbo'
        })
        await window.bandal.invoke('recordings:control', {
          id: session.id,
          action: 'start'
        })
        const began = performance.now()
        for (let offset = 0; offset < audio.length; offset += 8000) {
          const pcm = new Int16Array(
            audio
              .slice(offset, offset + 8000)
              .map((sample) => Math.round(sample * (sample < 0 ? 32768 : 32767)))
          )
          await window.bandal.invoke('recordings:append', {
            id: session.id,
            sequence: offset / 8000,
            pcm: new Uint8Array(pcm.buffer)
          })
          if (realtime)
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.max(0, began + (offset + pcm.length) / 16 - performance.now())
              )
            )
        }
        await window.bandal.invoke('recordings:control', {
          id: session.id,
          action: 'stop'
        })
        return session.id
      },
      { audio: samples, realtime: realtimeSeconds > 0 }
    )
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.bandal.invoke('recordings:read', { id }), id)).session
            .status,
        { timeout: 120_000 }
      )
      .toBe('complete')
    const detail = await page.evaluate((id) => window.bandal.invoke('recordings:read', { id }), id)
    expect(detail.session.transcribedSamples).toBe(samples.length)
    expect(detail.segments.map((segment) => segment.text).join(' ')).toMatch(/[가-힣]/)
    expect(detail.segments.length).toBeGreaterThan(1)
    for (const segment of detail.segments) {
      expect(segment.endSample).toBeGreaterThan(segment.startSample)
      expect(segment.endSample).toBeLessThanOrEqual(samples.length)
    }
    const exported = await page.evaluate(
      (id) => window.bandal.invoke('recordings:export', { id }),
      id
    )
    expect(exported.relPath).toMatch(/\.md$/)
    if (runtimeTimer) {
      clearInterval(runtimeTimer)
      expect(runtimeMetrics).toEqual(
        expect.arrayContaining([expect.objectContaining({ hidden: true })])
      )
      writeFileSync(
        join(directory!, 'realtime-benchmark.json'),
        JSON.stringify(
          {
            seconds: samples.length / 16000,
            session: detail.session,
            segments: detail.segments.length,
            runtimeMetrics
          },
          null,
          2
        ),
        { mode: 0o600 }
      )
      await bandal.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('index.html'))
          ?.show()
      })
    }
    await page.locator('.recording__history-item').filter({ hasText: 'Whisper 강의 검증' }).click()
    await expect(page.locator('.recording__transcript')).toContainText(/[가-힣]/)
    await page.locator('.recording').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: 'e2e/test-results/whisper-lecture.png' })
    await bandal.close()
    closed = true
    const restored = await launchBandal({ reuseProfileDir: bandal.profileDir })
    try {
      expect(
        (await restored.page.evaluate((id) => window.bandal.invoke('recordings:read', { id }), id))
          .segments
      ).toEqual(detail.segments)
    } finally {
      await restored.close()
    }
  } finally {
    if (runtimeTimer) clearInterval(runtimeTimer)
    if (!closed) await bandal.close()
  }
})

test('recording entry, model setup, theme and narrow layout', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '강의 기록')
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByRole('option', { name: '녹음 강의 · 실시간 자막' }).click()
    await expect(page.getByRole('heading', { name: '듣는 순간, 기록이 됩니다.' })).toBeVisible()
    await expect(page.getByRole('button', { name: '녹음 시작', exact: true })).toBeDisabled()
    await expect(page.getByText('Zipformer Korean', { exact: true })).toBeVisible()
    await expect(page.getByText('SenseVoice', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Whisper large-v3-turbo' })).toBeChecked()
    await page.screenshot({ path: 'e2e/test-results/recording-dark.png' })
    await page.evaluate(() => {
      document.documentElement.dataset['theme'] = 'light'
    })
    await page.screenshot({ path: 'e2e/test-results/recording-light.png' })
    await page.locator('.recording').evaluate((element) => {
      ;(element as HTMLElement).style.width = '380px'
    })
    expect(
      await page
        .locator('.recording')
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true)
    await page.screenshot({ path: 'e2e/test-results/recording-narrow.png' })
  } finally {
    await bandal.close()
  }
})

test('real native STT through AudioWorklet: pause, tab switch, stop, playback, export and restore', async () => {
  const models = process.env['BANDAL_STT_BENCHMARK_DIR']
  test.skip(!models, 'Requires the explicitly downloaded benchmark model cache')
  const soakSeconds = Number(process.env['BANDAL_STT_SOAK_SECONDS'] ?? '0')
  test.setTimeout(Math.max(180_000, soakSeconds * 1000 + 90_000))
  const bandal = await launchBandal({ keepProfileOnClose: true })
  let closed = false
  try {
    cpSync(models!, join(bandal.userDataDir, 'speech-models'), {
      recursive: true
    })
    await createCourse(bandal.page, '한국어 강의')
    const folder = readdirSync(bandal.dataRoot)[0]!
    writeFileSync(
      join(bandal.dataRoot, folder, '강의 필기.md'),
      '# 강의 필기\n\n학생이 작성한 원래 필기.\n'
    )
    const sample = readFileSync(join(models!, 'korean.wav')).toString('base64')
    await bandal.page.evaluate((base64) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext({ sampleRate: 16000 })
        const buffer = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer
        const decoded = await context.decodeAudioData(buffer)
        const padded = context.createBuffer(1, decoded.length + 32000, 16000)
        padded.copyToChannel(decoded.getChannelData(0), 0, 32000)
        const source = context.createBufferSource()
        source.buffer = padded
        source.loop = true
        const destination = context.createMediaStreamDestination()
        source.connect(destination)
        source.start()
        await context.resume()
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            source.stop()
            void context.close()
            stop()
          }
        }
        return destination.stream
      }
    }, sample)
    const { page } = bandal
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByRole('option', { name: '녹음 강의 · 실시간 자막' }).click()
    await page.getByRole('textbox', { name: '녹음 제목' }).fill('테스트 한국어 강의')
    await page.getByRole('radio', { name: 'Zipformer Korean' }).check()
    await page.getByRole('button', { name: '녹음 시작', exact: true }).click()
    await expect(page.locator('.recording-indicator')).toBeVisible({
      timeout: 60_000
    })
    await expect(page.locator('.recording__transcript')).toContainText(/애\s*쓰|괜찮/, {
      timeout: 30_000
    })
    if (soakSeconds > 0) {
      const metrics: unknown[] = []
      await bandal.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('index.html'))
          ?.minimize()
      })
      const started = Date.now()
      let previousSamples = 0
      while (Date.now() - started < soakSeconds * 1000) {
        await page.waitForTimeout(Math.min(20000, soakSeconds * 1000 - (Date.now() - started)))
        const state = await page.evaluate(async () => {
          const courses = await window.bandal.invoke('courses:list', {})
          return (
            await window.bandal.invoke('recordings:list', {
              courseId: courses[0]!.id
            })
          )[0]!
        })
        expect(state.status).toBe('recording')
        expect(state.samples).toBeGreaterThan(previousSamples)
        previousSamples = state.samples
        const processMetrics = await bandal.app.evaluate(({ app }) =>
          app.getAppMetrics().filter((metric) => metric.name === 'Bandal Speech')
        )
        metrics.push({
          elapsedMs: Date.now() - started,
          state,
          processMetrics
        })
      }
      writeFileSync(join(models!, 'live-soak.json'), JSON.stringify(metrics, null, 2))
      await bandal.app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((entry) =>
          entry.webContents.getURL().includes('index.html')
        )
        window?.restore()
        window?.show()
      })
    }
    await page.getByRole('button', { name: 'Ⅱ 일시정지' }).click()
    await expect(page.getByRole('button', { name: '▶ 이어 녹음' })).toBeVisible()
    const time = await page.locator('.recording__clock').textContent()
    await page.waitForTimeout(1500)
    expect(await page.locator('.recording__clock').textContent()).toBe(time)
    await page.getByRole('button', { name: '▶ 이어 녹음' }).click()
    await page.getByRole('button', { name: '☆ 중요 표시', exact: true }).click()
    await page.getByRole('combobox', { name: '연결할 자료' }).selectOption('강의 필기.md')
    await page.getByRole('button', { name: '＋ 현재 시간에 연결' }).click()
    await expect(page.locator('.recording__anchors')).toContainText('강의 필기.md')
    await page.locator('.recording__anchors').getByRole('button', { name: '강의 필기.md' }).click()
    await expect(page.locator('[aria-label="마크다운 필기 편집기"]')).toContainText(
      '학생이 작성한 원래 필기.'
    )
    await expect(page.getByRole('heading', { name: '테스트 한국어 강의' })).toBeVisible()
    const panels = await page.evaluate(() => ({
      recording: document.querySelector('.recording')!.getBoundingClientRect().right,
      note: document.querySelector('[aria-label="마크다운 필기 편집기"]')!.getBoundingClientRect()
        .left
    }))
    expect(panels.note).toBeGreaterThanOrEqual(panels.recording)
    await page.locator('.workspace-add-tab').last().click()
    await page.getByRole('option', { name: /새 마크다운/ }).click()
    await expect(page.locator('.recording-indicator')).toBeVisible()
    await page.locator('.recording-indicator').getByRole('button', { name: '강의 녹음 중' }).click()
    await expect(page.getByRole('heading', { name: '테스트 한국어 강의' })).toBeVisible()
    await page.getByRole('button', { name: '■ 녹음 종료' }).click()
    await expect(page.locator('.recording__state')).toHaveText('저장 완료', {
      timeout: 30_000
    })
    await expect(page.locator('.recording-indicator')).toHaveCount(0)
    await expect(page.locator('.recording__player audio')).toBeVisible()
    const wavPath = await page.evaluate(async () => {
      const courses = await window.bandal.invoke('courses:list', {})
      const recordings = await window.bandal.invoke('recordings:list', {
        courseId: courses[0]!.id
      })
      return recordings[0]!.audioRelPath
    })
    const wav = readFileSync(join(bandal.dataRoot, folder, wavPath))
    expect(wav.length).toBeGreaterThan(44 + 16000)
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44)
    const player = page.locator('.recording__player audio')
    await player.evaluate(async (element: HTMLAudioElement) => {
      element.muted = true
      await element.play()
    })
    await expect
      .poll(() => player.evaluate((element: HTMLAudioElement) => element.currentTime))
      .toBeGreaterThan(0.1)
    await player.evaluate((element: HTMLAudioElement) => element.pause())
    await page.screenshot({
      path: 'e2e/test-results/recording-transcript.png'
    })
    await page.getByRole('button', { name: '↗ 마크다운으로 내보내기' }).click()
    await expect(
      page.locator('[aria-label="마크다운 필기 편집기"]').filter({ hasText: '테스트 한국어 강의' })
    ).toBeVisible()
    await expect(
      page.locator('[aria-label="마크다운 필기 편집기"]').filter({ hasText: '테스트 한국어 강의' })
    ).toContainText('테스트 한국어 강의')
    expect(readFileSync(join(bandal.dataRoot, folder, '강의 필기.md'), 'utf8')).toContain(
      '학생이 작성한 원래 필기.'
    )
    await bandal.close()
    closed = true
    const restored = await launchBandal({ reuseProfileDir: bandal.profileDir })
    try {
      const saved = await restored.page.evaluate(async () => {
        const courses = await window.bandal.invoke('courses:list', {})
        return window.bandal.invoke('recordings:list', {
          courseId: courses[0]!.id
        })
      })
      expect(saved[0]?.status).toBe('complete')
      expect(saved[0]?.samples).toBeGreaterThan(16000)
      await restored.page
        .locator('.dv-tab')
        .filter({ has: restored.page.getByText('녹음', { exact: true }) })
        .click()
      await restored.page.getByRole('radio', { name: /SenseVoice/ }).check()
      await restored.page.getByRole('button', { name: '선택한 모델로 자막 다시 생성' }).click()
      await expect
        .poll(
          async () => {
            const detail = await restored.page.evaluate(
              (id) => window.bandal.invoke('recordings:read', { id }),
              saved[0]!.id
            )
            return {
              status: detail.session.status,
              model: detail.session.modelId,
              text: detail.segments.map((segment) => segment.text).join(' ')
            }
          },
          { timeout: 30_000 }
        )
        .toMatchObject({
          status: 'complete',
          model: 'sensevoice',
          text: expect.stringMatching(/[가-힣]/)
        })
    } finally {
      await restored.close()
    }
  } finally {
    if (!closed) await bandal.close()
  }
})

test('a killed native engine preserves incoming audio and can retranscribe it', async () => {
  const models = process.env['BANDAL_STT_BENCHMARK_DIR']
  test.skip(!models, 'Requires the explicitly downloaded benchmark model cache')
  test.setTimeout(90_000)
  const bandal = await launchBandal()
  try {
    cpSync(models!, join(bandal.userDataDir, 'speech-models'), {
      recursive: true
    })
    await createCourse(bandal.page, '엔진 장애 복구')
    const id = await bandal.page.evaluate(async () => {
      const courses = await window.bandal.invoke('courses:list', {})
      const recording = await window.bandal.invoke('recordings:create', {
        courseId: courses[0]!.id,
        title: '복구할 녹음',
        modelId: 'zipformer-ko'
      })
      await window.bandal.invoke('recordings:control', {
        id: recording.id,
        action: 'start'
      })
      return recording.id
    })
    await bandal.app.evaluate(({ app }) => {
      const speech = app.getAppMetrics().find((metric) => metric.name === 'Bandal Speech')
      if (!speech) throw new Error('Speech process not found')
      process.kill(speech.pid, 'SIGKILL')
    })
    await bandal.page.evaluate(async (id) => {
      await window.bandal.invoke('recordings:append', {
        id,
        sequence: 0,
        pcm: new Uint8Array(16000)
      })
    }, id)
    await expect
      .poll(() =>
        bandal.page.evaluate(
          async (id) => (await window.bandal.invoke('recordings:read', { id })).session.error,
          id
        )
      )
      .toBeTruthy()
    const stopped = await bandal.page.evaluate(async (id) => {
      await window.bandal.invoke('recordings:append', {
        id,
        sequence: 1,
        pcm: new Uint8Array(16000)
      })
      return window.bandal.invoke('recordings:control', { id, action: 'stop' })
    }, id)
    expect(stopped).toMatchObject({ samples: 16000, status: 'interrupted' })
    await bandal.page.evaluate(
      (id) =>
        window.bandal.invoke('recordings:control', {
          id,
          action: 'retry',
          modelId: 'sensevoice'
        }),
      id
    )
    await expect
      .poll(() =>
        bandal.page.evaluate(
          async (id) => (await window.bandal.invoke('recordings:read', { id })).session.status,
          id
        )
      )
      .toBe('complete')
  } finally {
    await bandal.close()
  }
})

test('a PDF time anchor opens the recorded page alongside the recording', async () => {
  const bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '강의자료 연결')
    const folder = readdirSync(bandal.dataRoot)[0]!
    const { PDFDocument } = await import('pdf-lib')
    const fixture = await PDFDocument.create()
    for (let page = 1; page <= 3; page++)
      fixture.addPage([595, 842]).drawText(`Lecture page ${page}`)
    writeFileSync(join(bandal.dataRoot, folder, 'slides.pdf'), await fixture.save())
    await bandal.page.evaluate(async () => {
      const courses = await window.bandal.invoke('courses:list', {})
      const recording = await window.bandal.invoke('recordings:create', {
        courseId: courses[0]!.id,
        title: 'PDF와 함께 듣기',
        modelId: 'zipformer-ko'
      })
      await window.bandal.invoke('recordings:anchor', {
        id: recording.id,
        label: '슬라이드',
        relPath: 'slides.pdf',
        page: 2,
        sample: 0
      })
    })
    const { page } = bandal
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByRole('option', { name: '녹음 강의 · 실시간 자막' }).click()
    await page
      .locator('.recording__anchors')
      .getByRole('button', { name: /슬라이드.*p\.2/ })
      .click()
    await expect(page.getByRole('textbox', { name: '페이지 이동' })).toHaveValue('2')
    await expect(page.getByRole('heading', { name: 'PDF와 함께 듣기' })).toBeVisible()
  } finally {
    await bandal.close()
  }
})
