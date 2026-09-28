import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { FileEntry } from '../lib/supabase'
import { fileUrl } from '../lib/supabase'
import { trimVideo } from '../lib/clip'

export type ClipHandle = {
  isClipped: () => boolean
  exportClip: () => Promise<void>
}

type Props = {
  video: HTMLVideoElement | null
  file: FileEntry
  handle?: Ref<ClipHandle | null>
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00.0'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const d = Math.floor((s % 1) * 10)
  return `${m}:${String(sec).padStart(2, '0')}.${d}`
}

export function ClipControls({ video, file, handle }: Props) {
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [inPt, setInPt] = useState(0)
  const [outPt, setOutPt] = useState(0)
  const [looping, setLooping] = useState(false)
  const [exportPhase, setExportPhase] = useState<'' | 'loading' | 'fetching' | 'trimming'>('')
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'in' | 'out' | null>(null)
  const rafRef = useRef(0)

  const clipRef = useRef({ inPt: 0, outPt: 0, looping: false })
  useEffect(() => { clipRef.current = { inPt, outPt, looping } })

  useEffect(() => {
    if (!video) return

    const onMeta = () => {
      const d = video.duration
      if (!isFinite(d)) return
      setDuration(d)
      setOutPt(d)
      clipRef.current.outPt = d
    }
    const onPlay = () => {
      setPlaying(true)
      const tick = () => {
        setTime(video.currentTime)
        const { looping, inPt, outPt } = clipRef.current
        if (looping && video.currentTime >= outPt) video.currentTime = inPt
        if (!video.paused) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    const onPause = () => setPlaying(false)
    const onSeeked = () => setTime(video.currentTime)

    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    if (video.duration && isFinite(video.duration)) onMeta()
    if (!video.paused) onPlay()

    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      cancelAnimationFrame(rafRef.current)
    }
  }, [video])

  const posToTime = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el || !duration) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
  }, [duration])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return
      e.preventDefault()
      const t = posToTime(e.clientX)
      if (dragRef.current === 'in') {
        const v = Math.max(0, Math.min(t, clipRef.current.outPt - 0.1))
        setInPt(v)
        clipRef.current.inPt = v
      } else {
        const v = Math.min(duration, Math.max(t, clipRef.current.inPt + 0.1))
        setOutPt(v)
        clipRef.current.outPt = v
      }
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [posToTime, duration])

  const togglePlay = useCallback(() => {
    if (!video) return
    video.paused ? video.play() : video.pause()
  }, [video])

  const markIn = useCallback(() => {
    if (!video) return
    const v = Math.min(video.currentTime, clipRef.current.outPt - 0.1)
    setInPt(v)
    clipRef.current.inPt = v
  }, [video])

  const markOut = useCallback(() => {
    if (!video) return
    const v = Math.max(video.currentTime, clipRef.current.inPt + 0.1)
    setOutPt(v)
    clipRef.current.outPt = v
  }, [video])

  const preview = useCallback(() => {
    if (!video) return
    if (clipRef.current.looping) {
      setLooping(false)
      clipRef.current.looping = false
    } else {
      video.currentTime = clipRef.current.inPt
      video.play()
      setLooping(true)
      clipRef.current.looping = true
    }
  }, [video])

  const reset = useCallback(() => {
    setInPt(0)
    setOutPt(duration)
    setLooping(false)
    clipRef.current = { inPt: 0, outPt: duration, looping: false }
  }, [duration])

  const onTrackDown = useCallback((e: React.PointerEvent) => {
    if (!video) return
    const t = posToTime(e.clientX)
    video.currentTime = t
    setTime(t)
  }, [video, posToTime])

  const saveClip = useCallback(async () => {
    if (!video || exportPhase) return

    try {
      await trimVideo(
        fileUrl(file.cloudflare),
        clipRef.current.inPt,
        clipRef.current.outPt,
        file.name,
        setExportPhase,
      )
    } catch (err) {
      console.error('Clip export failed:', err)
    } finally {
      setExportPhase('')
    }
  }, [video, file, exportPhase])

  useImperativeHandle(handle, () => ({
    isClipped: () => clipRef.current.inPt > 0.05 || clipRef.current.outPt < duration - 0.05,
    exportClip: saveClip,
  }), [duration, saveClip])

  // Keyboard shortcuts
  useEffect(() => {
    if (!video) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'i': case 'I':
          e.preventDefault()
          markIn()
          break
        case 'o': case 'O':
          e.preventDefault()
          markOut()
          break
        case 'p': case 'P':
          e.preventDefault()
          preview()
          break
        case 'ArrowLeft':
          e.preventDefault()
          video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 5 : 1))
          setTime(video.currentTime)
          break
        case 'ArrowRight':
          e.preventDefault()
          video.currentTime = Math.min(duration, video.currentTime + (e.shiftKey ? 5 : 1))
          setTime(video.currentTime)
          break
        case 'r': case 'R':
          if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); reset() }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [video, duration, togglePlay, markIn, markOut, preview, reset])

  if (!duration) return null

  const inFrac = inPt / duration
  const outFrac = outPt / duration
  const timeFrac = Math.min(time / duration, 1)
  const clipLen = outPt - inPt
  const exportLabel = exportPhase === 'loading' ? '● Loading…'
    : exportPhase === 'fetching' ? '● Fetching…'
    : exportPhase === 'trimming' ? '● Trimming…'
    : '↓ Save clip'

  return (
    <div className="clip" onClick={e => e.stopPropagation()}>
      <div className="clip-track" ref={trackRef} onPointerDown={onTrackDown}>
        <div className="clip-region" style={{ left: `${inFrac * 100}%`, width: `${(outFrac - inFrac) * 100}%` }} />
        <div className="clip-head" style={{ left: `${timeFrac * 100}%` }} />
        <div
          className="clip-handle"
          style={{ left: `${inFrac * 100}%` }}
          onPointerDown={e => { e.stopPropagation(); dragRef.current = 'in' }}
        />
        <div
          className="clip-handle"
          style={{ left: `${outFrac * 100}%` }}
          onPointerDown={e => { e.stopPropagation(); dragRef.current = 'out' }}
        />
      </div>

      <div className="clip-info">
        <span><b>{fmt(time)}</b> / {fmt(duration)}</span>
        <span>In <b>{fmt(inPt)}</b></span>
        <span>Out <b>{fmt(outPt)}</b></span>
        <span>Clip <b>{fmt(clipLen)}</b></span>
      </div>

      <div className="clip-bar">
        <button className="clip-btn" onClick={togglePlay} title="Play / Pause (Space)">
          {playing ? '⏸' : '▶'}
        </button>
        <div className="clip-sep" />
        <button className="clip-btn" onClick={markIn} title="Set in point (I)">⌜ In</button>
        <button className="clip-btn" onClick={markOut} title="Set out point (O)">Out ⌝</button>
        <button className={`clip-btn ${looping ? 'active' : ''}`} onClick={preview} title="Preview clip loop (P)">
          ⟲ {looping ? 'Looping' : 'Preview'}
        </button>
        <div className="clip-sep" />
        <button className="clip-btn" onClick={saveClip} disabled={!!exportPhase} title="Trim and download clip">
          {exportLabel}
        </button>
        <button className="clip-btn" onClick={reset} title="Reset clip points (R)">↺</button>
      </div>
    </div>
  )
}
