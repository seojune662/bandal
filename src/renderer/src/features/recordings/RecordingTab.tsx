import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../../shared/tabs'
import type {
  RecordingAnchor,
  RecordingDetail,
  RecordingSession,
  SpeechModelId,
  SpeechModelState,
  TranscriptSegment
} from '../../../../shared/recording'
import {
  DEFAULT_SPEECH_MODEL,
  recordingTime,
  RECORDING_SAMPLE_RATE
} from '../../../../shared/recording'
import type { MaterialNode } from '../../../../shared/types/materials'
import { invoke, onPush } from '../../lib/ipc'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { TabKindIcon } from '../workspace/workspaceIcons'
import { descriptorFor } from '../workspace/tabIdentity'
import { mediaUrlFor } from '../materials/mediaUrl'
import { requestPdfPageNavigation } from '../pdf/pdfPageNavigation'
import { pauseCapture, startCapture, stopCapture, useCaptureStore } from './captureStore'
import './recording.css'

const STATUS: Record<RecordingSession['status'], string> = {
  ready: '녹음 준비',
  recording: '녹음 중',
  paused: '일시정지',
  processing: '자막 마무리 중',
  complete: '저장 완료',
  interrupted: '중단된 녹음'
}
function flatten(nodes: MaterialNode[]): MaterialNode[] {
  return nodes.flatMap((node) =>
    node.kind === 'dir'
      ? flatten(node.children ?? [])
      : ['pdf', 'note'].includes(node.kind)
        ? [node]
        : []
  )
}
function mergeSegments(
  previous: TranscriptSegment[],
  next: TranscriptSegment[]
): TranscriptSegment[] {
  return [...new Map([...previous, ...next].map((segment) => [segment.id, segment])).values()]
    .sort((a, b) => a.id - b.id)
    .slice(-200)
}
function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return '마이크 접근이 허용되지 않았습니다. 시스템 설정에서 반달의 마이크 권한을 켠 뒤 다시 시도해 주세요.'
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error)
}

export default function RecordingTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = props.params['descriptor'] as TabDescriptor
  if (descriptor.kind !== 'recording') return <div />
  return <RecordingWorkspace courseId={descriptor.payload.courseId} />
}

function RecordingWorkspace({ courseId }: { courseId: string }): JSX.Element {
  const capture = useCaptureStore()
  const tree = useMaterialsStore((state) => state.tree)
  const [models, setModels] = useState<SpeechModelState[]>([])
  const [modelId, setModelId] = useState<SpeechModelId>(DEFAULT_SPEECH_MODEL)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('default')
  const [sessions, setSessions] = useState<RecordingSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState<{
    text: string
    startSample: number
  } | null>(null)
  const [rtf, setRtf] = useState<number | null>(null)
  const [cooling, setCooling] = useState(false)
  const [query, setQuery] = useState('')
  const [linkPath, setLinkPath] = useState('')
  const [linkPage, setLinkPage] = useState(1)
  const [playhead, setPlayhead] = useState(0)
  const [follow, setFollow] = useState(true)
  const [history, setHistory] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const settings = useRef<HTMLElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const loadSerial = useRef(0)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const session =
    detail && capture.session?.id === detail.session.id
      ? { ...detail.session, ...capture.session }
      : (detail?.session ?? null)
  const isCapturing = !!session && capture.session?.id === session.id
  const model = models.find((entry) => entry.id === modelId)
  const materials = flatten(tree)

  const refreshList = useCallback(async () => {
    setSessions(await invoke('recordings:list', { courseId }))
  }, [courseId])
  const load = useCallback(async (id: string, afterId?: number) => {
    const serial = ++loadSerial.current
    const next = await invoke('recordings:read', {
      id,
      ...(afterId !== undefined ? { afterId } : {})
    })
    if (serial === loadSerial.current && selectedRef.current === id) {
      setDetail(next)
      if (next.session.status === 'ready') setModelId(next.session.modelId)
    }
  }, [])
  useEffect(() => {
    let alive = true
    void Promise.all([invoke('recordings:models', {}), invoke('recordings:list', { courseId })])
      .then(([available, saved]) => {
        if (!alive) return
        setModels(available)
        setSessions(saved)
        const active = useCaptureStore.getState().session
        setSelectedId(active?.courseId === courseId ? active.id : (saved[0]?.id ?? null))
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    const devicesChanged = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (alive) setDevices(all.filter((entry) => entry.kind === 'audioinput'))
        })
        .catch(() => undefined)
    }
    devicesChanged()
    navigator.mediaDevices.addEventListener('devicechange', devicesChanged)
    const unsubscribe = onPush('recordings:modelsChanged', setModels)
    return () => {
      alive = false
      unsubscribe()
      navigator.mediaDevices.removeEventListener('devicechange', devicesChanged)
    }
  }, [courseId])
  useEffect(() => {
    setPartial(null)
    setQuery('')
    setHistory(false)
    setFollow(true)
    setPlayhead(0)
    setDetail(null)
    if (selectedId) void load(selectedId).catch((err: unknown) => setError(errorText(err)))
    return () => {
      loadSerial.current++
    }
  }, [selectedId, load])
  useEffect(
    () =>
      onPush('recordings:event', (event) => {
        if (event.session.courseId !== courseId) return
        setSessions((previous) =>
          [event.session, ...previous.filter((entry) => entry.id !== event.session.id)].sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt)
          )
        )
        if (event.session.id !== selectedRef.current) return
        setRtf(event.rtf)
        setCooling(event.cooling)
        setPartial(event.partial)
        setDetail((previous) =>
          previous?.session.id === event.session.id
            ? {
                ...previous,
                session: event.session,
                segments:
                  event.segment && !history
                    ? mergeSegments(previous.segments, [event.segment])
                    : previous.segments
              }
            : previous
        )
      }),
    [courseId, history]
  )
  useEffect(() => {
    const scroll = end.current?.parentElement
    if (scroll && follow && !history && !query) scroll.scrollTop = scroll.scrollHeight
  }, [detail?.segments, partial?.text, follow, history, query])

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  async function begin(): Promise<void> {
    if (!model || model.status !== 'installed' || model.unavailableReason) {
      setError('오른쪽에서 음성 모델을 먼저 다운로드해 주세요.')
      return
    }
    let recording = session?.status === 'ready' ? session : null
    if (!recording)
      recording = await invoke('recordings:create', {
        courseId,
        title: title.trim() || `${new Date().toLocaleDateString('ko-KR')} 강의`,
        modelId
      })
    selectedRef.current = recording.id
    setSelectedId(recording.id)
    await startCapture(recording, deviceId)
    await load(recording.id)
    await refreshList()
  }
  function seek(sample: number): void {
    if (!audio.current) return
    audio.current.currentTime = sample / RECORDING_SAMPLE_RATE
    void audio.current.play().catch((err: unknown) => setError(errorText(err)))
  }
  async function mark(linked: boolean): Promise<void> {
    if (!session) return
    const path = linked ? linkPath : ''
    if (linked && !path) {
      setError('연결할 자료를 선택해 주세요.')
      return
    }
    const pdf = path.toLowerCase().endsWith('.pdf')
    const anchor = await invoke('recordings:anchor', {
      id: session.id,
      label: path ? path.split('/').at(-1)! : '중요한 순간',
      sample: isCapturing ? capture.session!.samples : Math.floor(playhead * RECORDING_SAMPLE_RATE),
      ...(path ? { relPath: path } : {}),
      ...(pdf ? { page: linkPage } : {})
    })
    setDetail((previous) =>
      previous ? { ...previous, anchors: [...previous.anchors, anchor] } : previous
    )
  }
  function openAnchor(anchor: RecordingAnchor): void {
    if (!session || !anchor.relPath) return
    const pdf = anchor.relPath.toLowerCase().endsWith('.pdf')
    useWorkspaceStore.getState().openTab(
      descriptorFor(pdf ? 'pdf' : 'note', {
        courseId,
        relPath: anchor.relPath
      }),
      {
        beside: true
      }
    )
    if (pdf && anchor.page)
      requestPdfPageNavigation({
        courseId,
        relPath: anchor.relPath,
        page: anchor.page
      })
  }
  const segments = (detail?.segments ?? []).filter((segment) =>
    segment.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )
  const elapsed = session?.samples ?? 0
  const lag = session
    ? Math.max(0, session.samples - session.transcribedSamples) / RECORDING_SAMPLE_RATE
    : 0
  const inputBlocked = busy || capture.busy || !!capture.session || session?.status === 'processing'
  return (
    <section className="recording" aria-label="강의 녹음" data-status={session?.status ?? 'new'}>
      <header className="recording__header">
        <div className="recording__heading">
          <TabKindIcon kind="recording" />
          <span>녹음</span>
          <span className="recording__local">기기에서 처리</span>
        </div>
        <div className="recording__header-actions">
          <button
            className="recording__text-button recording__settings-button"
            onClick={() => settings.current?.scrollIntoView({ block: 'start' })}
          >
            설정·자료 ↓
          </button>
          <button
            className="recording__text-button"
            disabled={busy}
            onClick={() => {
              setSelectedId(null)
              setDetail(null)
              setTitle('')
              setError(null)
            }}
          >
            ＋ 새 녹음
          </button>
        </div>
      </header>
      <div className="recording__layout">
        <div className="recording__main">
          <div className="recording__intro">
            <p className="recording__eyebrow">LECTURE NOTES</p>
            {session ? (
              <h1>{session.title}</h1>
            ) : (
              <>
                <h1>듣는 순간, 기록이 됩니다.</h1>
                <p>강의는 자막으로 남기고, 중요한 순간은 자료에 연결하세요.</p>
              </>
            )}
          </div>
          <section className="recording__console" aria-label="녹음 제어">
            <div className="recording__console-top">
              <span
                className="recording__state"
                data-live={isCapturing && session?.status === 'recording'}
              >
                <i />
                {session ? STATUS[session.status] : '시작할 준비가 되셨나요?'}
              </span>
              <span className="recording__clock">{recordingTime(elapsed)}</span>
            </div>
            <div className="recording__wave" aria-hidden="true">
              {Array.from({ length: 48 }, (_, index) => (
                <i
                  key={index}
                  style={{
                    height: `${isCapturing ? 4 + Math.min(1, capture.level * 12) * (10 + ((index * 17) % 39)) : 4}px`
                  }}
                />
              ))}
            </div>
            {!session && (
              <label className="recording__title-input">
                <span className="sr-only">녹음 제목</span>
                <input
                  placeholder="강의 제목을 입력하세요"
                  value={title}
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            )}
            <div className="recording__controls">
              {isCapturing ? (
                <>
                  <button
                    className="recording__primary"
                    disabled={busy || capture.busy}
                    onClick={() => void run(pauseCapture)}
                  >
                    {session?.status === 'paused' ? '▶ 이어 녹음' : 'Ⅱ 일시정지'}
                  </button>
                  <button disabled={busy || capture.busy} onClick={() => void run(stopCapture)}>
                    ■ 녹음 종료
                  </button>
                  <button disabled={busy} onClick={() => void run(() => mark(false))}>
                    ☆ 중요 표시
                  </button>
                </>
              ) : !session || session.status === 'ready' ? (
                <button
                  className="recording__primary"
                  disabled={
                    inputBlocked || model?.status !== 'installed' || !!model?.unavailableReason
                  }
                  onClick={() => void run(begin)}
                >
                  <TabKindIcon kind="recording" />
                  {busy || capture.busy ? '녹음 준비 중…' : '녹음 시작'}
                </button>
              ) : (
                <span className="recording__muted">
                  {session.status === 'processing'
                    ? '저장된 음성의 마지막 자막을 정리하고 있어요.'
                    : '자막의 시간을 누르면 그 순간부터 다시 들을 수 있어요.'}
                </span>
              )}
            </div>
            <p className="recording__footnote">
              {isCapturing
                ? '원음 자동 저장 중 · 다른 탭에서도 녹음이 계속됩니다.'
                : model?.status !== 'installed'
                  ? '녹음 설정에서 음성 모델을 먼저 다운로드해 주세요.'
                  : '모델을 한 번 다운로드하면 인터넷 없이 사용할 수 있어요.'}
            </p>
          </section>
          {(error || capture.error || session?.error) && (
            <div className="recording__error" role="alert">
              {error || capture.error || session?.error}
            </div>
          )}
          {session && !isCapturing && session.samples > 0 && session.status !== 'processing' && (
            <div className="recording__player">
              <audio
                key={`${session.id}-${session.status}`}
                ref={audio}
                controls
                preload="metadata"
                src={mediaUrlFor(courseId, session.audioRelPath)}
                onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
              />
              <button onClick={() => void run(() => mark(false))} disabled={busy}>
                ☆ 현재 위치 표시
              </button>
            </div>
          )}
          <section className="recording__transcript" aria-label="강의 자막">
            <div className="recording__section-heading">
              <h2>강의 자막</h2>
              <span>
                {cooling
                  ? '기기가 식으면 자막 처리를 이어갑니다'
                  : lag > 3
                    ? `${Math.round(lag)}초 분량 처리 대기`
                    : partial
                      ? '인식 중'
                      : '시간과 함께 쌓이는 기록'}
              </span>
            </div>
            {session && (
              <div className="recording__transcript-tools">
                <input
                  aria-label="현재 페이지 자막 검색"
                  placeholder="현재 페이지에서 찾기…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button
                  aria-pressed={follow && !history}
                  onClick={() => {
                    setFollow(true)
                    setHistory(false)
                    void load(session.id)
                  }}
                >
                  최신 자막
                </button>
              </div>
            )}
            <div className="recording__transcript-scroll" onWheel={() => setFollow(false)}>
              {segments.length === 0 && !partial && (
                <div className="recording__empty">
                  <span className="recording__empty-mark">“</span>
                  <h3>
                    {query
                      ? '일치하는 자막이 없어요'
                      : session?.status === 'recording'
                        ? '강의에 귀 기울이고 있어요'
                        : '놓친 문장도, 다시 만날 수 있게'}
                  </h3>
                  <p>
                    {query
                      ? '다른 검색어로 찾아보세요.'
                      : '녹음을 시작하면 여기에 자막이 나타납니다.\n말소리가 있는 구간을 인식해 차곡차곡 저장해요.'}
                  </p>
                </div>
              )}
              {segments.map((segment) => (
                <article className="recording__segment" key={segment.id}>
                  <button
                    className="recording__timestamp"
                    disabled={isCapturing || session?.status === 'processing'}
                    onClick={() => seek(segment.startSample)}
                  >
                    {recordingTime(segment.startSample)}
                  </button>
                  <p>{segment.text}</p>
                </article>
              ))}
              {partial && !history && !query && (
                <article className="recording__segment recording__segment--partial">
                  <span className="recording__timestamp">{recordingTime(partial.startSample)}</span>
                  <p>
                    {partial.text}
                    <span className="recording__cursor" />
                  </p>
                </article>
              )}
              <div ref={end} />
            </div>
            {detail && detail.segments.length > 0 && (
              <div className="recording__pagination">
                <button
                  onClick={() => {
                    setHistory(true)
                    void load(detail.session.id, 0)
                  }}
                >
                  처음부터 보기
                </button>
                {history && (
                  <button onClick={() => void load(detail.session.id, detail.segments.at(-1)!.id)}>
                    다음 자막
                  </button>
                )}
                <span>최대 200개씩 표시</span>
              </div>
            )}
          </section>
        </div>
        <aside ref={settings} className="recording__sidebar" aria-label="녹음 설정과 연결 자료">
          <section className="recording__side-section">
            <div className="recording__section-heading">
              <h2>녹음 설정</h2>
              <span>로컬 STT</span>
            </div>
            <label>
              마이크
              <select
                value={deviceId}
                disabled={inputBlocked}
                onChange={(event) => setDeviceId(event.target.value)}
              >
                <option value="default">시스템 기본 마이크</option>
                {devices
                  .filter((device) => device.deviceId !== 'default')
                  .map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `마이크 ${index + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            <div className="recording__model-label">
              음성 모델 <span>필요한 모델만 설치</span>
            </div>
            {models.map((entry) => (
              <div key={entry.id} className="recording__model" data-selected={modelId === entry.id}>
                <label>
                  <input
                    type="radio"
                    name={`speech-model-${courseId}`}
                    checked={modelId === entry.id}
                    disabled={inputBlocked || session?.status === 'ready'}
                    onChange={() => setModelId(entry.id)}
                  />
                  <strong>{entry.name}</strong>
                  <span>{Math.round(entry.bytes / 1e6)} MB</span>
                </label>
                <p>{entry.description}</p>
                {entry.unavailableReason ? (
                  <p className="recording__model-error">{entry.unavailableReason}</p>
                ) : entry.status === 'installed' ? (
                  <span className="recording__installed">✓ 다운로드 완료</span>
                ) : entry.status === 'downloading' || entry.status === 'verifying' ? (
                  <>
                    <progress
                      aria-label={`${entry.name} 다운로드`}
                      value={entry.downloadedBytes}
                      max={entry.bytes}
                    />
                    <div className="recording__model-progress">
                      <span>
                        {entry.status === 'verifying'
                          ? '파일 확인 중…'
                          : `${Math.floor((entry.downloadedBytes / entry.bytes) * 100)}% 다운로드 중`}
                      </span>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await invoke('recordings:cancelDownload', {
                              modelId: entry.id
                            })
                          })
                        }
                      >
                        취소
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className="recording__download"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await invoke('recordings:downloadModel', {
                          modelId: entry.id
                        })
                      })
                    }
                  >
                    ↓ {entry.status === 'error' ? '다시 다운로드' : '모델 다운로드'}
                  </button>
                )}
                {entry.error && (
                  <p role="alert" className="recording__model-error">
                    {entry.error}
                  </p>
                )}
              </div>
            ))}
            {rtf !== null && (
              <p className="recording__footnote">
                최근 인식 시간 / 음성 길이: {rtf.toFixed(2)} · 낮을수록 빠름
              </p>
            )}
          </section>
          <section className="recording__side-section">
            <div className="recording__section-heading">
              <h2>자료 연결</h2>
              <span>PDF · MD</span>
            </div>
            <p className="recording__muted">지금 듣는 내용을 강의자료와 이어 두세요.</p>
            <select
              aria-label="연결할 자료"
              value={linkPath}
              onChange={(event) => setLinkPath(event.target.value)}
            >
              <option value="">과목 자료 선택</option>
              {materials.map((material) => (
                <option key={material.relPath} value={material.relPath}>
                  {material.relPath}
                </option>
              ))}
            </select>
            {linkPath.toLowerCase().endsWith('.pdf') && (
              <label className="recording__page-input">
                페이지
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={linkPage}
                  onChange={(event) => setLinkPage(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
            )}
            <button
              className="recording__link-button"
              disabled={!session || !linkPath || busy}
              onClick={() => void run(() => mark(true))}
            >
              ＋ 현재 시간에 연결
            </button>
            <div className="recording__anchors">
              {detail?.anchors.map((anchor) => (
                <div className="recording__anchor" key={anchor.id}>
                  <button
                    className="recording__timestamp"
                    onClick={() => seek(anchor.sample)}
                    disabled={isCapturing}
                  >
                    {recordingTime(anchor.sample)}
                  </button>
                  <button
                    onClick={() => (anchor.relPath ? openAnchor(anchor) : seek(anchor.sample))}
                  >
                    {anchor.relPath ? '↗ ' : '☆ '}
                    {anchor.label}
                    {anchor.page ? ` · p.${anchor.page}` : ''}
                  </button>
                </div>
              ))}
            </div>
          </section>
          {session && session.samples > 0 && (
            <section className="recording__side-section">
              <button
                className="recording__wide"
                disabled={busy || isCapturing || session.status === 'processing'}
                onClick={() =>
                  void run(async () => {
                    const ref = await invoke('recordings:export', {
                      id: session.id
                    })
                    useWorkspaceStore.getState().openTab(descriptorFor('note', ref))
                  })
                }
              >
                ↗ 마크다운으로 내보내기
              </button>
              <button
                className="recording__text-button"
                disabled={
                  busy ||
                  !!capture.session ||
                  session.status === 'processing' ||
                  model?.status !== 'installed' ||
                  !!model?.unavailableReason
                }
                onClick={() =>
                  void run(async () => {
                    await invoke('recordings:control', {
                      id: session.id,
                      action: 'retry',
                      modelId
                    })
                    await load(session.id)
                  })
                }
              >
                선택한 모델로 자막 다시 생성
              </button>
            </section>
          )}
          <section className="recording__side-section">
            <div className="recording__section-heading">
              <h2>지난 녹음</h2>
              <span>{sessions.length}</span>
            </div>
            {sessions.length === 0 ? (
              <p className="recording__muted">이 과목의 첫 강의를 남겨 보세요.</p>
            ) : (
              sessions.map((saved) => (
                <button
                  key={saved.id}
                  className="recording__history-item"
                  aria-pressed={selectedId === saved.id}
                  onClick={() => setSelectedId(saved.id)}
                >
                  <span>{saved.title}</span>
                  <small>
                    {saved.createdAt.slice(5, 10).replace('-', '.')} ·{' '}
                    {recordingTime(saved.samples)} · {STATUS[saved.status]}
                  </small>
                </button>
              ))
            )}
          </section>
        </aside>
      </div>
    </section>
  )
}
