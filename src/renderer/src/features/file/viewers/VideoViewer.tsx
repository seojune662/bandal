import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from '../../../app/toast'
import { invoke } from '../../../lib/ipc'
import { mediaUrlFor } from '../../materials/mediaUrl'
import {
  createVideoSaveTiming,
  planVideoDebouncedSave,
  planVideoTimeUpdate,
  playbackRateForVideoRestore,
  positionForVideoRestore,
  registerVideoProgressFlushTriggers,
  VIDEO_PLAYBACK_RATES,
  videoProgressMemory,
  type VideoPlaybackRate,
  type VideoProgressSnapshot
} from '../lib/videoProgress'

interface VideoViewerProps {
  courseId: string
  relPath: string
}

type VideoStatus = 'loading' | 'ready' | 'error'

function videoName(relPath: string): string {
  return relPath.split('/').at(-1) ?? relPath
}

function snapshotForVideo(video: HTMLVideoElement): VideoProgressSnapshot {
  const durationSec = Number.isFinite(video.duration) ? video.duration : null
  const currentTime = Number.isFinite(video.currentTime)
    ? Math.max(0, video.currentTime)
    : 0

  return {
    positionSec:
      durationSec === null ? currentTime : Math.min(currentTime, durationSec),
    durationSec,
    playbackRate: playbackRateForVideoRestore(video.playbackRate)
  }
}

export function VideoViewer({
  courseId,
  relPath
}: VideoViewerProps): JSX.Element {
  const [status, setStatus] = useState<VideoStatus>('loading')
  const [revealing, setRevealing] = useState(false)
  const [playbackRate, setPlaybackRate] = useState<VideoPlaybackRate>(1)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const aliveRef = useRef(true)
  const progressReadyRef = useRef(false)
  const restoreTokenRef = useRef(0)
  const restoredSeekTargetRef = useRef<number | null>(null)
  const restoredRateTargetRef = useRef<VideoPlaybackRate | null>(null)
  const latestProgressRef = useRef<VideoProgressSnapshot | null>(null)
  const timingRef = useRef(createVideoSaveTiming())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const src = mediaUrlFor(courseId, relPath)

  const clearSaveTimer = useCallback((): void => {
    if (saveTimerRef.current === null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
  }, [])

  const rememberProgress = useCallback(
    (video: HTMLVideoElement): VideoProgressSnapshot => {
      const progress = snapshotForVideo(video)
      latestProgressRef.current = progress
      videoProgressMemory.set(courseId, relPath, progress)
      return progress
    },
    [courseId, relPath]
  )

  const flushProgress = useCallback((): void => {
    clearSaveTimer()
    if (!progressReadyRef.current) return

    const nowMs = Date.now()
    timingRef.current = {
      lastMemoryWriteAtMs: nowMs,
      ipcDueAtMs: null
    }
    const video = videoRef.current
    const progress =
      video === null ? latestProgressRef.current : rememberProgress(video)
    if (progress === null) return

    void invoke('media:setProgress', {
      courseId,
      relPath,
      ...progress
    }).catch(() => undefined)
  }, [clearSaveTimer, courseId, relPath, rememberProgress])

  const scheduleProgressFlush = useCallback(
    (dueAtMs: number): void => {
      clearSaveTimer()
      saveTimerRef.current = setTimeout(
        flushProgress,
        Math.max(0, dueAtMs - Date.now())
      )
    },
    [clearSaveTimer, flushProgress]
  )

  const scheduleDebouncedProgressFlush = useCallback((): void => {
    const timing = planVideoDebouncedSave(timingRef.current, Date.now())
    timingRef.current = timing
    if (timing.ipcDueAtMs !== null) {
      scheduleProgressFlush(timing.ipcDueAtMs)
    }
  }, [scheduleProgressFlush])

  const restoreProgress = useCallback(
    async (video: HTMLVideoElement): Promise<void> => {
      const restoreToken = ++restoreTokenRef.current
      progressReadyRef.current = false

      let progress = videoProgressMemory.get(courseId, relPath)
      if (progress === null) {
        try {
          progress = await invoke('media:getProgress', { courseId, relPath })
        } catch {
          progress = null
        }
      }

      if (
        !aliveRef.current ||
        restoreToken !== restoreTokenRef.current ||
        videoRef.current !== video ||
        video.error !== null
      ) {
        return
      }

      const nextRate = playbackRateForVideoRestore(progress?.playbackRate ?? 1)
      const durationSec = Number.isFinite(video.duration) ? video.duration : null
      const nextPosition = positionForVideoRestore(
        progress?.positionSec ?? 0,
        durationSec
      )

      restoredRateTargetRef.current =
        video.playbackRate === nextRate ? null : nextRate
      restoredSeekTargetRef.current =
        Math.abs(video.currentTime - nextPosition) < 0.01
          ? null
          : nextPosition
      video.playbackRate = nextRate
      video.currentTime = nextPosition
      setPlaybackRate(nextRate)

      const restoredProgress: VideoProgressSnapshot = {
        positionSec: nextPosition,
        durationSec,
        playbackRate: nextRate
      }
      latestProgressRef.current = restoredProgress
      videoProgressMemory.set(courseId, relPath, restoredProgress)
      timingRef.current = {
        lastMemoryWriteAtMs: Date.now(),
        ipcDueAtMs: null
      }
      progressReadyRef.current = true
      setStatus('ready')
    },
    [courseId, relPath]
  )

  const handleTimeUpdate = useCallback(
    (video: HTMLVideoElement): void => {
      if (!progressReadyRef.current) return

      const progress = snapshotForVideo(video)
      latestProgressRef.current = progress
      const plan = planVideoTimeUpdate(timingRef.current, Date.now())
      timingRef.current = plan.timing
      if (plan.writeMemory) {
        videoProgressMemory.set(courseId, relPath, progress)
      }
      if (plan.timing.ipcDueAtMs !== null) {
        scheduleProgressFlush(plan.timing.ipcDueAtMs)
      }
    },
    [courseId, relPath, scheduleProgressFlush]
  )

  const handleRateChange = useCallback(
    (video: HTMLVideoElement): void => {
      const nextRate = playbackRateForVideoRestore(video.playbackRate)
      if (video.playbackRate !== nextRate) {
        video.playbackRate = nextRate
        return
      }
      setPlaybackRate(nextRate)

      if (restoredRateTargetRef.current === nextRate) {
        restoredRateTargetRef.current = null
        return
      }
      restoredRateTargetRef.current = null
      if (!progressReadyRef.current) return

      rememberProgress(video)
      timingRef.current = {
        lastMemoryWriteAtMs: Date.now(),
        ipcDueAtMs: timingRef.current.ipcDueAtMs
      }
      scheduleDebouncedProgressFlush()
    },
    [rememberProgress, scheduleDebouncedProgressFlush]
  )

  const handleSeeked = useCallback(
    (video: HTMLVideoElement): void => {
      const restoredTarget = restoredSeekTargetRef.current
      restoredSeekTargetRef.current = null
      if (
        restoredTarget !== null &&
        Math.abs(video.currentTime - restoredTarget) < 0.25
      ) {
        return
      }
      flushProgress()
    },
    [flushProgress]
  )

  useEffect(() => {
    aliveRef.current = true
    const dispose = registerVideoProgressFlushTriggers({
      windowTarget: window,
      documentTarget: document,
      visibilityState: () => document.visibilityState,
      flush: flushProgress
    })

    return () => {
      restoreTokenRef.current += 1
      dispose()
      flushProgress()
      clearSaveTimer()
      aliveRef.current = false
    }
  }, [clearSaveTimer, flushProgress])

  return (
    <div
      className="file-video"
      role="region"
      aria-label={`${videoName(relPath)} 동영상`}
    >
      <video
        ref={videoRef}
        className="file-video__media"
        controls
        src={src}
        preload="metadata"
        aria-hidden={status === 'ready' ? undefined : true}
        tabIndex={status === 'ready' ? 0 : -1}
        data-visible={status === 'ready' || undefined}
        onLoadedMetadata={(event) => {
          void restoreProgress(event.currentTarget)
        }}
        onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
        onPause={() => flushProgress()}
        onSeeked={(event) => handleSeeked(event.currentTarget)}
        onRateChange={(event) => handleRateChange(event.currentTarget)}
        onError={() => {
          restoreTokenRef.current += 1
          progressReadyRef.current = false
          clearSaveTimer()
          setStatus('error')
        }}
        onKeyDown={(event) => {
          const video = event.currentTarget

          if (event.key === ' ' || event.code === 'Space') {
            event.preventDefault()
            if (event.repeat) return
            if (video.paused) {
              void video.play().catch(() => undefined)
            } else {
              video.pause()
            }
            return
          }

          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            video.currentTime = Math.max(0, video.currentTime - 5)
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            const end = Number.isFinite(video.duration)
              ? video.duration
              : Number.POSITIVE_INFINITY
            video.currentTime = Math.min(end, video.currentTime + 5)
          }
        }}
      />

      {status === 'ready' && (
        <div className="file-video__rate-control">
          <select
            className="file-video__rate"
            aria-label="재생 속도"
            value={playbackRate}
            onChange={(event) => {
              const nextRate = playbackRateForVideoRestore(
                Number(event.currentTarget.value)
              )
              setPlaybackRate(nextRate)
              const video = videoRef.current
              if (video !== null) video.playbackRate = nextRate
            }}
          >
            {VIDEO_PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </div>
      )}

      {status === 'loading' && (
        <div className="file-status file-video__status" role="status">
          동영상을 불러오는 중…
        </div>
      )}

      {status === 'error' && (
        <div
          className="file-status file-status--error file-video__status"
          role="alert"
        >
          <h2>재생할 수 없는 형식이에요</h2>
          <button
            type="button"
            className="file-action"
            disabled={revealing}
            onClick={() => {
              setRevealing(true)
              void invoke('materials:reveal', { courseId, relPath })
                .catch(() => {
                  showToast('파일을 Finder에서 열지 못했습니다.', 'danger')
                })
                .finally(() => setRevealing(false))
            }}
          >
            Finder에서 열기
          </button>
        </div>
      )}
    </div>
  )
}
