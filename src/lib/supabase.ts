import { createClient } from '@supabase/supabase-js'
import { createLogger } from './debug'

const log = createLogger('db')

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

export const R2_WORKER_URL = (import.meta.env.VITE_R2_WORKER_URL ?? '').replace(/\/+$/, '')

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_KEY || 'missing', {
  auth: { persistSession: false },
})

log.debug('Supabase client ready', { url: SUPABASE_URL || '(missing)', hasKey: Boolean(SUPABASE_KEY) })

export type FolderRef = { id: string; name: string; created?: string }

export type FileEntry = {
  id: string
  name: string
  path: string
  cloudflare: string
  created: string
}

export type ContentItem = { folder: FolderRef } | { file: FileEntry }

export type Folder = {
  id: string
  name: string
  created: string
  path: string
  content: ContentItem[]
  trail: FolderRef[]
}

export type TreeNode = { id: string; name: string; path: string }

export function fileKind(entry: FileEntry): 'picture' | 'video' {
  return entry.cloudflare.startsWith('pictures/') ? 'picture' : 'video'
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const elapsed = log.timer()
  log.debug(`→ ${fn}`, args)
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    log.error(`✕ ${fn} failed after ${elapsed()}ms: ${error.message}`, { args, error })
    throw new Error(error.message)
  }
  log.debug(`← ${fn} ${elapsed()}ms`, data)
  return data as T
}

export async function openFilesystem(name: string) {
  const fs = await rpc<Folder & { isNew: boolean }>('open_filesystem', { p_name: name })
  log.info(fs.isNew ? `Created file system "${fs.id}"` : `Opened file system "${fs.id}"`)
  return fs
}

export const getFolder = (id: string) => rpc<Folder | null>('get_folder', { p_id: id })

export const getTree = (fs: string) => rpc<TreeNode[]>('get_tree', { p_fs: fs })

export const createFolder = (name: string, parent: string) =>
  rpc<FolderRef>('create_folder', { p_name: name, p_parent: parent })

export const addFile = (folder: string, cloudflare: string, name: string) =>
  rpc<FileEntry>('add_file', { p_folder: folder, p_cloudflare: cloudflare, p_name: name })

export async function deleteFile(id: string) {
  const { cloudflare } = await rpc<{ cloudflare: string }>('delete_file', { p_id: id })
  await deleteFromR2(cloudflare)
}

export async function deleteFolder(id: string) {
  const { keys } = await rpc<{ keys: string[] }>('delete_folder', { p_id: id })
  await Promise.allSettled(keys.map(deleteFromR2))
}

async function deleteFromR2(key: string) {
  await fetch(`${R2_WORKER_URL}/file/${encodeURI(key)}`, { method: 'DELETE' })
}

export function fileUrl(cloudflare: string) {
  return `${R2_WORKER_URL}/file/${encodeURI(cloudflare)}`
}

export function downloadUrl(cloudflare: string, name: string) {
  return `${R2_WORKER_URL}/file/${encodeURI(cloudflare)}?download=${encodeURIComponent(name)}`
}
