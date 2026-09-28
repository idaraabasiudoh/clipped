import { addFile, type FileEntry } from './supabase'
import { createLogger } from './debug'
import { formatBytes, shortId } from './util'

const log = createLogger('upload')

// Files are sent byte-for-byte: no canvas re-encoding, no resizing, no compression.
// Small files go as a single PUT; large files use R2 multipart upload so there's
// no per-request size limit (each part ≤ 90 MB, up to 10 000 parts = ~900 GB).

const WORKER_URL = (import.meta.env.VITE_R2_WORKER_URL ?? '').replace(/\/+$/, '')

/** Part size for multipart uploads (90 MB — safely under Workers' 100 MB free-plan limit). */
const PART_SIZE = 90 * 1024 * 1024

/** Files smaller than this go as a single PUT. */
const MULTIPART_THRESHOLD = PART_SIZE

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', tif: 'image/tiff',
  tiff: 'image/tiff', svg: 'image/svg+xml', dng: 'image/x-adobe-dng', raw: 'image/x-raw',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', '3gp': 'video/3gpp', mts: 'video/mp2t', m2ts: 'video/mp2t', hevc: 'video/hevc',
}

function extOf(name: string) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
}

/** Returns the mime type and bucket folder for a file, or null if it isn't a picture/video. */
export function classify(file: File): { mime: string; dir: 'pictures' | 'videos'; ext: string } | null {
  const ext = extOf(file.name)
  const mime = file.type || EXT_MIME[ext] || ''
  if (mime.startsWith('image/')) return { mime, dir: 'pictures', ext: ext || mime.split('/')[1] }
  if (mime.startsWith('video/')) return { mime, dir: 'videos', ext: ext || mime.split('/')[1] }
  return null
}

// ---- helpers ----------------------------------------------------------------

async function workerFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${WORKER_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text()
    let msg: string
    try { msg = JSON.parse(body).error } catch { msg = body || `HTTP ${res.status}` }
    throw new Error(msg)
  }
  return res
}

async function workerJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await workerFetch(path, init)
  return res.json() as Promise<T>
}

// ---- single PUT upload ------------------------------------------------------

async function uploadSingle(
  key: string,
  file: File,
  mime: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Use XMLHttpRequest for progress tracking on the upload stream
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${WORKER_URL}/upload/${encodeURIComponent(key)}`)
    xhr.setRequestHeader('Content-Type', mime)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new Error('Cancelled'))

    if (signal) {
      if (signal.aborted) { reject(new Error('Cancelled')); return }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(file)
  })
}

// ---- multipart upload -------------------------------------------------------

async function uploadMultipart(
  key: string,
  file: File,
  mime: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 1. Create the multipart upload
  const { uploadId } = await workerJson<{ uploadId: string; key: string }>(
    '/multipart/create',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, contentType: mime }), signal },
  )

  const totalParts = Math.ceil(file.size / PART_SIZE)
  const parts: { partNumber: number; etag: string }[] = []
  let bytesSent = 0

  try {
    for (let i = 0; i < totalParts; i++) {
      if (signal?.aborted) throw new Error('Cancelled')

      const start = i * PART_SIZE
      const end = Math.min(start + PART_SIZE, file.size)
      const chunk = file.slice(start, end)
      const partNumber = i + 1

      const result = await workerJson<{ partNumber: number; etag: string }>(
        `/multipart/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
        { method: 'PUT', body: chunk, signal },
      )

      parts.push(result)
      bytesSent += end - start
      onProgress(bytesSent / file.size)
    }

    // 2. Complete the multipart upload
    await workerJson('/multipart/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, parts }),
      signal,
    })
  } catch (err) {
    // Abort the multipart upload on failure so R2 doesn't keep dangling parts
    try {
      await workerJson('/multipart/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, uploadId }),
      })
    } catch { /* best-effort cleanup */ }
    throw err
  }
}

// ---- public API -------------------------------------------------------------

export function uploadFile(
  folderId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<FileEntry>; cancel: () => void } {
  const kind = classify(file)
  if (!kind) {
    log.warn(`Rejected "${file.name}": not a picture or video`, { type: file.type })
    return { promise: Promise.reject(new Error('Only pictures and videos')), cancel: () => {} }
  }

  const key = `${kind.dir}/${folderId}/${shortId(12)}.${kind.ext}`
  const tag = `[${file.name}]`
  const elapsed = log.timer()
  const controller = new AbortController()
  let lastLogged = 0

  log.info(`${tag} upload start`, { key, size: formatBytes(file.size), bytes: file.size, mime: kind.mime })

  const progress = (fraction: number) => {
    if (fraction - lastLogged >= 0.25) {
      lastLogged = fraction
      log.debug(`${tag} ${Math.round(fraction * 100)}% (${formatBytes(fraction * file.size)} / ${formatBytes(file.size)})`)
    }
    onProgress(fraction)
  }

  const useMultipart = file.size > MULTIPART_THRESHOLD

  const promise = (
    useMultipart
      ? uploadMultipart(key, file, kind.mime, progress, controller.signal)
      : uploadSingle(key, file, kind.mime, progress, controller.signal)
  )
    .then(() => {
      const ms = elapsed()
      log.info(`${tag} ${useMultipart ? 'multipart ' : ''}upload done in ${(ms / 1000).toFixed(1)}s (${formatBytes((file.size / ms) * 1000)}/s)`)
      return addFile(folderId, key, file.name)
    })
    .then((entry) => {
      log.info(`${tag} added to folder ${folderId}`, entry)
      return entry
    })
    .catch((err: Error) => {
      if (err.message === 'Cancelled') log.info(`${tag} cancelled`)
      else log.error(`${tag} upload failed: ${err.message}`, { key, err })
      throw err
    })

  const cancel = () => controller.abort()
  return { promise, cancel }
}
