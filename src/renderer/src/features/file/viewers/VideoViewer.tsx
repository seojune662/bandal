import { useState } from 'react'
import { showToast } from '../../../app/toast'
import { invoke } from '../../../lib/ipc'
import { mediaUrlFor } from '../../materials/mediaUrl'

interface VideoViewerProps {
  courseId: string
  relPath: string
}

type VideoStatus = 'loading' | 'ready' | 'error'

function videoName(relPath: string): string {
  return relPath.split('/').at(-1) ?? relPath
}

export function VideoViewer({
  courseId,
  relPath
}: VideoViewerProps): JSX.Element {
  const [status, setStatus] = useState<VideoStatus>('loading')
  const [revealing, setRevealing] = useState(false)
  const src = mediaUrlFor(courseId, relPath)

  return (
    <div
      className="file-video"
      role="region"
      aria-label={`${videoName(relPath)} 동영상`}
    >
      <video
        className="file-video__media"
        controls
        src={src}
        preload="metadata"
        aria-hidden={status === 'ready' ? undefined : true}
        tabIndex={status === 'ready' ? 0 : -1}
        data-visible={status === 'ready' || undefined}
        onLoadedMetadata={() => setStatus('ready')}
        onError={() => setStatus('error')}
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
