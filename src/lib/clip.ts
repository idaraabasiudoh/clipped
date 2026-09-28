import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ff: FFmpeg | null = null

async function getFFmpeg() {
  if (ff?.loaded) return ff
  ff = new FFmpeg()
  await ff.load()
  return ff
}

export async function trimVideo(
  url: string,
  inPt: number,
  outPt: number,
  originalName: string,
  onPhase: (phase: 'loading' | 'fetching' | 'trimming') => void,
): Promise<void> {
  onPhase('loading')
  const ffmpeg = await getFFmpeg()

  const ext = originalName.includes('.') ? originalName.split('.').pop()! : 'mp4'
  const inputName = `input.${ext}`
  const outputName = `clip.${ext}`

  onPhase('fetching')
  const data = await fetchFile(url)
  await ffmpeg.writeFile(inputName, data)

  onPhase('trimming')
  await ffmpeg.exec([
    '-ss', String(inPt),
    '-to', String(outPt),
    '-i', inputName,
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    outputName,
  ])

  const output = await ffmpeg.readFile(outputName) as Uint8Array
  const blob = new Blob([output], { type: `video/${ext === 'mov' ? 'quicktime' : ext}` })

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `clip-${originalName.replace(/\.[^.]+$/, '')}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)

  await ffmpeg.deleteFile(inputName)
  await ffmpeg.deleteFile(outputName)
}
