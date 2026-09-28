/**
 * Cloudflare Worker — R2 upload proxy & file server for Clipped.
 *
 * Uses an R2 binding (no S3 keys needed). Supports:
 *  - Single PUT for files ≤ 95 MB
 *  - Multipart upload for anything larger (each part ≤ 95 MB, unlimited total)
 *  - File serving with cache-forever headers (object keys are unique)
 *  - Download with content-disposition
 */

interface Env {
  MEDIA: R2Bucket
  /** Optional comma-separated list of allowed origins. '*' or omit to allow all. */
  ALLOWED_ORIGINS?: string
}

// ---- helpers ----------------------------------------------------------------

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '*'
  const allowed = env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? []
  const allow = allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': allow ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'ETag',
    Vary: 'Origin',
  }
}

function json(data: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function err(msg: string, cors: Record<string, string>, status = 400) {
  return json({ error: msg }, cors, status)
}

// ---- handler ----------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname)

    try {
      // ------------------------------------------------------------------
      // PUT /upload/<key>  —  single-object upload (streams to R2)
      // ------------------------------------------------------------------
      if (request.method === 'PUT' && path.startsWith('/upload/')) {
        const key = path.slice('/upload/'.length)
        if (!key) return err('Missing key', cors)

        const ct = request.headers.get('Content-Type') || 'application/octet-stream'
        await env.MEDIA.put(key, request.body, {
          httpMetadata: { contentType: ct, cacheControl: 'public, max-age=31536000, immutable' },
        })
        return json({ key }, cors)
      }

      // ------------------------------------------------------------------
      // POST /multipart/create  —  start a multipart upload
      // body: { key: string, contentType?: string }
      // ------------------------------------------------------------------
      if (request.method === 'POST' && path === '/multipart/create') {
        const body = (await request.json()) as { key?: string; contentType?: string }
        if (!body.key) return err('Missing key', cors)

        const upload = await env.MEDIA.createMultipartUpload(body.key, {
          httpMetadata: {
            contentType: body.contentType || 'application/octet-stream',
            cacheControl: 'public, max-age=31536000, immutable',
          },
        })
        return json({ key: upload.key, uploadId: upload.uploadId }, cors)
      }

      // ------------------------------------------------------------------
      // PUT /multipart/part?key=…&uploadId=…&partNumber=N  —  upload one part
      // body: raw bytes (streamed straight to R2)
      // ------------------------------------------------------------------
      if (request.method === 'PUT' && path === '/multipart/part') {
        const key = url.searchParams.get('key')
        const uploadId = url.searchParams.get('uploadId')
        const partNumber = Number(url.searchParams.get('partNumber'))
        if (!key || !uploadId || !partNumber) return err('Missing key/uploadId/partNumber', cors)

        const upload = env.MEDIA.resumeMultipartUpload(key, uploadId)
        const part = await upload.uploadPart(partNumber, request.body!)
        return json({ partNumber: part.partNumber, etag: part.etag }, cors)
      }

      // ------------------------------------------------------------------
      // POST /multipart/complete  —  finish the multipart upload
      // body: { key, uploadId, parts: [{partNumber, etag}] }
      // ------------------------------------------------------------------
      if (request.method === 'POST' && path === '/multipart/complete') {
        const body = (await request.json()) as {
          key?: string
          uploadId?: string
          parts?: R2UploadedPart[]
        }
        if (!body.key || !body.uploadId || !body.parts?.length) {
          return err('Missing key/uploadId/parts', cors)
        }
        const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId)
        await upload.complete(body.parts)
        return json({ key: body.key }, cors)
      }

      // ------------------------------------------------------------------
      // POST /multipart/abort  —  cancel a multipart upload
      // body: { key, uploadId }
      // ------------------------------------------------------------------
      if (request.method === 'POST' && path === '/multipart/abort') {
        const body = (await request.json()) as { key?: string; uploadId?: string }
        if (!body.key || !body.uploadId) return err('Missing key/uploadId', cors)
        const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId)
        await upload.abort()
        return json({ aborted: true }, cors)
      }

      // ------------------------------------------------------------------
      // GET /file/<key>  —  serve a file from R2
      // ?download=<name>  →  attachment header
      // ------------------------------------------------------------------
      if (request.method === 'GET' && path.startsWith('/file/')) {
        const key = path.slice('/file/'.length)
        if (!key) return err('Missing key', cors)

        const rangeHeader = request.headers.get('Range')
        let rangeOffset: number | undefined
        let rangeLength: number | undefined
        const opts: R2GetOptions = {}
        if (rangeHeader) {
          const m = rangeHeader.match(/^bytes=(\d+)-(\d*)$/)
          if (m) {
            rangeOffset = Number(m[1])
            rangeLength = m[2] ? Number(m[2]) - rangeOffset + 1 : undefined
            opts.range = rangeLength
              ? { offset: rangeOffset, length: rangeLength }
              : { offset: rangeOffset }
          }
        }

        const obj = await env.MEDIA.get(key, opts)
        if (!obj) return new Response('Not found', { status: 404, headers: cors })

        const totalSize = obj.size
        const headers = new Headers(cors)
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
        headers.set('Cache-Control', 'public, max-age=31536000, immutable')
        headers.set('ETag', obj.etag)
        headers.set('Accept-Ranges', 'bytes')

        const dl = url.searchParams.get('download')
        if (dl) headers.set('Content-Disposition', `attachment; filename="${dl}"`)

        if (rangeOffset !== undefined && totalSize !== undefined) {
          const end = rangeLength ? rangeOffset + rangeLength - 1 : totalSize - 1
          headers.set('Content-Length', String(end - rangeOffset + 1))
          headers.set('Content-Range', `bytes ${rangeOffset}-${end}/${totalSize}`)
          return new Response(obj.body, { status: 206, headers })
        }

        if (totalSize !== undefined) headers.set('Content-Length', String(totalSize))
        return new Response(obj.body, { headers })
      }

      // ------------------------------------------------------------------
      // DELETE /file/<key>  —  delete a file from R2
      // ------------------------------------------------------------------
      if (request.method === 'DELETE' && path.startsWith('/file/')) {
        const key = path.slice('/file/'.length)
        if (!key) return err('Missing key', cors)

        await env.MEDIA.delete(key)
        return json({ deleted: key }, cors)
      }

      // ------------------------------------------------------------------
      // HEAD /file/<key>  —  check existence
      // ------------------------------------------------------------------
      if (request.method === 'HEAD' && path.startsWith('/file/')) {
        const key = path.slice('/file/'.length)
        const obj = await env.MEDIA.head(key)
        if (!obj) return new Response(null, { status: 404, headers: cors })

        const headers = new Headers(cors)
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
        if (obj.size !== undefined) headers.set('Content-Length', String(obj.size))
        return new Response(null, { status: 200, headers })
      }

      return new Response('Not found', { status: 404, headers: cors })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Internal error'
      console.error('Worker error:', e)
      return err(msg, cors, 500)
    }
  },
} satisfies ExportedHandler<Env>
