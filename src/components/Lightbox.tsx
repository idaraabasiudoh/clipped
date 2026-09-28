import { useEffect, useState } from 'react'
import { downloadUrl, fileKind, fileUrl, type FileEntry } from '../lib/supabase'
import { ClipControls } from './ClipControls'
import { ChevronLeft, ChevronRight, DownloadIcon, XIcon } from './Icons'

type Props = {
  files: FileEntry[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

export function Lightbox({ files, index, onIndex, onClose }: Props) {
  const file = files[index]
  const hasPrev = index > 0
  const hasNext = index < files.length - 1
  const isVideo = file ? fileKind(file) === 'video' : false
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (isVideo && ['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) return
      if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1)
      if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index, hasPrev, hasNext, onIndex, onClose, isVideo])

  // Warm the cache for neighbours so arrowing through photos feels instant.
  useEffect(() => {
    for (const f of [files[index - 1], files[index + 1]]) {
      if (f && fileKind(f) === 'picture') new Image().src = fileUrl(f.cloudflare)
    }
  }, [files, index])

  if (!file) return null
  const src = fileUrl(file.cloudflare)

  return (
    <div className={`lightbox ${isVideo ? 'lightbox-clip' : ''}`} role="dialog" aria-modal="true" aria-label={file.name} onClick={onClose}>
      <div className="viewfinder" aria-hidden>
        <i /> <i /> <i /> <i />
      </div>
      <header className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-title">
          <span className="truncate">{file.name}</span>
          <span className="muted">
            {String(index + 1).padStart(3, '0')} / {String(files.length).padStart(3, '0')}
            {file.name.includes('.') ? ` · ${file.name.split('.').pop()!.toUpperCase()}` : ''}
          </span>
        </div>
        <div className="row">
          <a className="icon-btn on-dark" href={downloadUrl(file.cloudflare, file.name)} title="Download original">
            <DownloadIcon />
          </a>
          <button className="icon-btn on-dark" onClick={onClose} title="Close (Esc)">
            <XIcon />
          </button>
        </div>
      </header>

      <div className="lightbox-stage">
        {fileKind(file) === 'picture' ? (
          <img key={file.id} src={src} alt={file.name} onClick={(e) => e.stopPropagation()} />
        ) : (
          <video
            key={file.id}
            ref={el => setVideoEl(el)}
            src={src}
            crossOrigin="anonymous"
            autoPlay
            playsInline
            preload="auto"
            onClick={(e) => {
              e.stopPropagation()
              if (e.currentTarget.paused) e.currentTarget.play()
              else e.currentTarget.pause()
            }}
          />
        )}
      </div>

      {isVideo && <ClipControls key={file.id} video={videoEl} file={file} />}

      {hasPrev && (
        <button
          className="lightbox-nav prev"
          onClick={(e) => (e.stopPropagation(), onIndex(index - 1))}
          aria-label="Previous"
        >
          <ChevronLeft width={26} height={26} />
        </button>
      )}
      {hasNext && (
        <button
          className="lightbox-nav next"
          onClick={(e) => (e.stopPropagation(), onIndex(index + 1))}
          aria-label="Next"
        >
          <ChevronRight width={26} height={26} />
        </button>
      )}
    </div>
  )
}
