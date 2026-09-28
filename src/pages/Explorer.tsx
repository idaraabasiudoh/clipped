import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ContextMenu, type MenuEntry } from '../components/ContextMenu'
import { FileView, type Item, type Sort, type SortKey } from '../components/FileView'
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  DownloadIcon,
  DriveIcon,
  EyeIcon,
  FolderGlyph,
  FolderPlus,
  GridIcon,
  LinkIcon,
  ListIcon,
  MenuIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from '../components/Icons'
import { Lightbox } from '../components/Lightbox'
import { Sidebar } from '../components/Sidebar'
import { UploadTray, type UploadItem } from '../components/UploadTray'
import { createLogger } from '../lib/debug'
import {
  createFolder,
  deleteFile,
  deleteFolder,
  downloadUrl,
  fileKind,
  fileUrl,
  getFolder,
  getTree,
  openFilesystem,
  supabase,
  type FileEntry,
  type Folder,
  type FolderRef,
  type TreeNode,
} from '../lib/supabase'
import { classify, uploadFile } from '../lib/upload'
import { FS_NAME_RE, formatBytes, getPref, plural, rememberFs, setPref, shortId } from '../lib/util'

const log = createLogger('explorer')
const CONCURRENCY = 3
const isTouch = () => window.matchMedia('(hover: none)').matches

function kindLabel(name: string, type: 'picture' | 'video') {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''
  return `${ext ? ext + ' ' : ''}${type === 'picture' ? 'image' : 'video'}`
}

export function Explorer() {
  const { fs = '', '*': rest = '' } = useParams()
  const currentId = rest.split('/')[0] || fs
  const validName = FS_NAME_RE.test(fs)
  const navigate = useNavigate()

  // ---- File system + folder state ------------------------------------------------

  const [fsState, setFsState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({ status: 'loading' })
  const [tree, setTree] = useState<TreeNode[]>([])
  const [folder, setFolder] = useState<Folder | null>(null)
  const [folderError, setFolderError] = useState<'missing' | 'error' | null>(null)
  const cache = useRef(new Map<string, Folder>())
  const currentRef = useRef(currentId)
  currentRef.current = currentId

  const pathFor = useCallback((id: string) => (id === fs ? `/${fs}` : `/${fs}/${id}`), [fs])

  const refreshTree = useCallback(() => {
    getTree(fs)
      .then(setTree)
      .catch(() => {})
  }, [fs])

  const loadFolder = useCallback(
    async (id: string) => {
      try {
        const f = await getFolder(id)
        if (currentRef.current !== id) return // navigated away meanwhile
        if (!f || f.trail[0]?.id !== fs) {
          log.warn(`Folder ${id} not found in file system ${fs}`)
          setFolderError('missing')
          return
        }
        cache.current.set(id, f)
        setFolder(f)
        setFolderError(null)
      } catch {
        if (currentRef.current === id && !cache.current.has(id)) setFolderError('error')
      }
    },
    [fs],
  )

  // Open (or create) the file system.
  useEffect(() => {
    if (!validName) return
    let cancelled = false
    setFsState({ status: 'loading' })
    cache.current.clear()
    openFilesystem(fs)
      .then((root) => {
        if (cancelled) return
        cache.current.set(root.id, root)
        rememberFs(fs)
        setFsState({ status: 'ready' })
        refreshTree()
      })
      .catch((err: Error) => !cancelled && setFsState({ status: 'error', error: err.message }))
    return () => {
      cancelled = true
    }
  }, [fs, validName, refreshTree])

  // Show the current folder: instantly from cache if we have it, then revalidate.
  useEffect(() => {
    if (fsState.status !== 'ready') return
    const cached = cache.current.get(currentId)
    log.debug(`Navigate → ${currentId}`, { cached: Boolean(cached) })
    setFolder(cached ?? null)
    setFolderError(null)
    setSelection(new Set())
    setQuery('')
    setCreating(false)
    loadFolder(currentId)
  }, [currentId, fsState.status, loadFolder])

  useEffect(() => {
    document.title = folder ? `${folder.name} — ${fs}` : fs
  }, [folder, fs])

  // Live updates for the whole file system.
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (fsState.status !== 'ready') return
    let timer: number | undefined
    const changed = new Set<string>()
    const channel = supabase
      .channel(`fs:${fs}`)
      .on('broadcast', { event: 'changed' }, (msg) => {
        const id = (msg.payload as { id?: string } | undefined)?.id
        log.debug('Realtime: folder changed', { id })
        if (id) {
          changed.add(id)
          cache.current.delete(id)
        }
        clearTimeout(timer)
        timer = window.setTimeout(() => {
          if (!id || changed.has(currentRef.current)) loadFolder(currentRef.current)
          changed.clear()
          refreshTree()
        }, 300)
      })
      .subscribe((status, err) => {
        log.debug(`Realtime channel fs:${fs} → ${status}`, err)
        setLive(status === 'SUBSCRIBED')
      })
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
      setLive(false)
    }
  }, [fs, fsState.status, loadFolder, refreshTree])

  // ---- View state ------------------------------------------------------------------

  const [view, setView] = useState<'list' | 'grid'>(() => getPref('view', 'list'))
  const [sort, setSort] = useState<Sort>({ key: 'name', asc: true })
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const anchor = useRef<number | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item | null } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number>(undefined)

  const notify = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  const changeView = (v: 'list' | 'grid') => {
    setView(v)
    setPref('view', v)
  }

  const items = useMemo<Item[]>(() => {
    if (!folder) return []
    const q = query.trim().toLowerCase()
    const folders: Item[] = folder.content
      .filter((c): c is { folder: FolderRef } => 'folder' in c)
      .map((c) => c.folder)
      .map((f) => ({
        key: f.id,
        type: 'folder' as const,
        name: f.name,
        size: null,
        created: f.created ?? folder.created,
        kindLabel: 'Folder',
      }))
    const files: Item[] = folder.content
      .filter((c): c is { file: FileEntry } => 'file' in c)
      .map((c) => c.file)
      .map((f) => ({
        key: f.id,
        type: fileKind(f),
        name: f.name,
        size: null,
        created: f.created,
        kindLabel: kindLabel(f.name, fileKind(f)),
        file: f,
      }))
    const dir = sort.asc ? 1 : -1
    const compare = (a: Item, b: Item) => {
      switch (sort.key) {
        case 'created':
          return a.created.localeCompare(b.created) * dir
        case 'size':
          return ((a.size ?? 0) - (b.size ?? 0)) * dir
        case 'kind':
          return a.kindLabel.localeCompare(b.kindLabel) * dir || a.name.localeCompare(b.name, undefined, { numeric: true })
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true }) * dir
      }
    }
    return [...folders.sort(compare), ...files.sort(compare)].filter((i) => !q || i.name.toLowerCase().includes(q))
  }, [folder, query, sort])

  const previewFiles = useMemo(() => items.filter((i) => i.file).map((i) => i.file!), [items])

  const onSort = (key: SortKey) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === 'name' || key === 'kind' }))

  // ---- Navigation + opening ----------------------------------------------------------

  const parentId = folder && folder.trail.length > 1 ? folder.trail[folder.trail.length - 2].id : null

  const openItem = useCallback(
    (item: Item) => {
      if (item.type === 'folder') navigate(pathFor(item.key))
      else setPreview(previewFiles.findIndex((f) => f.id === item.key))
    },
    [navigate, pathFor, previewFiles],
  )

  const onItemClick = (e: MouseEvent, item: Item, index: number) => {
    if (isTouch() && !e.metaKey && !e.ctrlKey && !e.shiftKey) return openItem(item)
    setSelection((prev) => {
      if (e.metaKey || e.ctrlKey) {
        const next = new Set(prev)
        if (next.has(item.key)) next.delete(item.key)
        else next.add(item.key)
        anchor.current = index
        return next
      }
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
        return new Set(items.slice(a, b + 1).map((i) => i.key))
      }
      anchor.current = index
      return new Set([item.key])
    })
  }

  const copy = useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text)
        log.debug(`Copied ${what}`, text)
        notify(`${what} copied`)
      } catch (err) {
        log.warn('Clipboard write failed', err)
        notify('Couldn’t copy — your browser blocked clipboard access')
      }
    },
    [notify],
  )

  // ---- Creating folders --------------------------------------------------------------

  async function commitNewFolder(name: string) {
    setCreating(false)
    const parent = currentId
    try {
      const created = await createFolder(name, parent)
      log.info(`Created folder "${name}"`, created)
      if (currentRef.current === parent) {
        setFolder((f) => f && { ...f, content: [...f.content, { folder: created }] })
        setSelection(new Set([created.id]))
      }
      refreshTree()
    } catch (err) {
      notify((err as Error).message)
    }
  }

  // ---- Deleting ---------------------------------------------------------------------

  const deleteItems = useCallback(
    async (toDelete: Item[]) => {
      for (const item of toDelete) {
        try {
          if (item.type === 'folder') {
            await deleteFolder(item.key)
            log.info(`Deleted folder "${item.name}"`)
          } else {
            await deleteFile(item.key)
            log.info(`Deleted file "${item.name}"`)
          }
        } catch (err) {
          notify(`Failed to delete "${item.name}": ${(err as Error).message}`)
        }
      }
      setFolder((f) => {
        if (!f) return f
        const deleted = new Set(toDelete.map((i) => i.key))
        return {
          ...f,
          content: f.content.filter((c) => {
            if ('folder' in c) return !deleted.has(c.folder.id)
            if ('file' in c) return !deleted.has(c.file.id)
            return true
          }),
        }
      })
      setSelection(new Set())
      refreshTree()
    },
    [notify, refreshTree],
  )

  // ---- Uploading --------------------------------------------------------------------

  const [uploads, setUploads] = useState<UploadItem[]>([])
  const queue = useRef<{ key: string; file: File; target: string }[]>([])
  const running = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string>(currentId)

  const patch = (key: string, p: Partial<UploadItem>) =>
    setUploads((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  const addToCurrent = (entry: FileEntry) =>
    setFolder((f) => f && { ...f, content: [...f.content, { file: entry }] })

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const { key, file, target } = queue.current.shift()!
      running.current++
      log.debug(`Queue: starting ${file.name} (${running.current}/${CONCURRENCY} slots, ${queue.current.length} waiting)`)
      const { promise, cancel } = uploadFile(target, file, (progress) => patch(key, { progress }))
      patch(key, { status: 'uploading', cancel })
      promise
        .then((entry) => {
          patch(key, { status: 'done', progress: 1, cancel: undefined })
          if (currentRef.current === target) addToCurrent(entry)
          else cache.current.delete(target)
        })
        .catch((err: Error) => patch(key, { status: 'error', error: err.message, cancel: undefined }))
        .finally(() => {
          running.current--
          pump()
        })
    }
  }, [])

  const enqueue = useCallback(
    (list: FileList | File[], target: string) => {
      const accepted: File[] = []
      const skipped: string[] = []
      for (const file of Array.from(list)) {
        if (classify(file)) accepted.push(file)
        else skipped.push(file.name)
      }
      log.info(`Queued ${accepted.length} file(s) → folder ${target}`, { skipped })
      if (skipped.length) notify(`Skipped ${plural(skipped.length, 'file')} — only pictures and videos can be added`)
      if (!accepted.length) return
      const newItems: UploadItem[] = accepted.map((file) => {
        const key = shortId()
        queue.current.push({ key, file, target })
        return {
          key,
          name: file.name,
          size: file.size,
          progress: 0,
          status: 'queued',
          cancel: () => {
            queue.current = queue.current.filter((q) => q.key !== key)
            patch(key, { status: 'error', error: 'Cancelled', cancel: undefined })
          },
        }
      })
      setUploads((u) => [...u.filter((i) => i.status !== 'done'), ...newItems])
      pump()
    },
    [pump, notify],
  )

  const pickFiles = useCallback((target: string) => {
    uploadTarget.current = target
    fileInput.current?.click()
  }, [])

  const uploading = uploads.some((u) => u.status === 'queued' || u.status === 'uploading')
  useEffect(() => {
    if (!uploading) return
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [uploading])

  // Drag & drop: onto a folder (row, tile, sidebar or path bar) or anywhere else for the open folder.
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  useEffect(() => {
    if (fsState.status !== 'ready') return
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const targetOf = (e: DragEvent) =>
      (e.target instanceof Element && e.target.closest('[data-drop]')?.getAttribute('data-drop')) || null
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDropTarget(targetOf(e))
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) {
        setDragging(false)
        setDropTarget(null)
      }
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      setDropTarget(null)
      const target = targetOf(e) ?? currentRef.current
      log.debug(`Dropped ${e.dataTransfer?.files.length} file(s) on ${target}`)
      if (e.dataTransfer?.files.length) enqueue(e.dataTransfer.files, target)
    }
    const paste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) {
        log.debug(`Pasted ${e.clipboardData.files.length} file(s)`)
        enqueue(e.clipboardData.files, currentRef.current)
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', paste)
    }
  }, [fsState.status, enqueue])

  // ---- Keyboard ----------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (preview !== null || menu || creating) return
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      const selIndex = items.findIndex((i) => selection.has(i.key))
      const select = (i: number) => {
        const item = items[Math.max(0, Math.min(items.length - 1, i))]
        if (!item) return
        anchor.current = items.indexOf(item)
        setSelection(new Set([item.key]))
        document.getElementById(`item-${item.key}`)?.scrollIntoView({ block: 'nearest' })
      }
      const grid = document.querySelector('[data-grid]')
      const cols = view === 'grid' && grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1

      if (mod && e.key === 'ArrowUp') {
        e.preventDefault()
        if (parentId) navigate(pathFor(parentId))
      } else if ((mod && e.key === 'ArrowDown') || e.key === 'Enter') {
        e.preventDefault()
        if (selIndex >= 0) openItem(items[selIndex])
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        if (parentId) navigate(pathFor(parentId))
      } else if (e.key === ' ') {
        e.preventDefault()
        const item = items[selIndex]
        if (item?.file) openItem(item)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        select(selIndex < 0 ? 0 : selIndex + cols)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        select(selIndex < 0 ? 0 : selIndex - cols)
      } else if (e.key === 'ArrowRight' && view === 'grid') {
        e.preventDefault()
        select(selIndex + 1)
      } else if (e.key === 'ArrowLeft' && view === 'grid') {
        e.preventDefault()
        select(selIndex - 1)
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection(new Set(items.map((i) => i.key)))
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setCreating(true)
      } else if (e.key === 'Escape') {
        setSelection(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selection, preview, menu, creating, view, parentId, navigate, pathFor, openItem])

  // ---- Context menu ------------------------------------------------------------------

  const onItemContext = (e: MouseEvent, item: Item) => {
    if (!selection.has(item.key)) setSelection(new Set([item.key]))
    setMenu({ x: e.clientX, y: e.clientY, item })
  }

  const menuEntries = (item: Item | null): MenuEntry[] => {
    const here = `${location.origin}${pathFor(currentId)}`
    if (!item) {
      return [
        { label: 'New folder', icon: <FolderPlus />, hint: '⇧⌘N', onSelect: () => setCreating(true) },
        { label: 'Upload files…', icon: <UploadIcon />, onSelect: () => pickFiles(currentId) },
        'separator',
        { label: 'Copy link to this folder', icon: <LinkIcon />, onSelect: () => copy(here, 'Link') },
        {
          label: 'Refresh',
          icon: <RefreshIcon />,
          onSelect: () => {
            loadFolder(currentId)
            refreshTree()
          },
        },
        'separator',
        view === 'list'
          ? { label: 'View as icons', icon: <GridIcon />, onSelect: () => changeView('grid') }
          : { label: 'View as list', icon: <ListIcon />, onSelect: () => changeView('list') },
      ]
    }
    if (item.type === 'folder') {
      return [
        { label: 'Open', icon: <FolderGlyph size={16} />, onSelect: () => openItem(item) },
        { label: 'Upload into folder…', icon: <UploadIcon />, onSelect: () => pickFiles(item.key) },
        'separator',
        { label: 'Copy link', icon: <LinkIcon />, onSelect: () => copy(`${location.origin}${pathFor(item.key)}`, 'Link') },
        'separator',
        { label: 'Delete folder', icon: <TrashIcon />, onSelect: () => deleteItems([item]) },
      ]
    }
    const file = item.file!
    return [
      { label: 'Preview', icon: <EyeIcon />, hint: 'Space', onSelect: () => openItem(item) },
      {
        label: 'Download original',
        icon: <DownloadIcon />,
        onSelect: () => {
          log.debug(`Download ${file.name}`)
          location.href = downloadUrl(file.cloudflare, file.name)
        },
      },
      'separator',
      { label: 'Copy file link', icon: <LinkIcon />, onSelect: () => copy(fileUrl(file.cloudflare), 'File link') },
      'separator',
      { label: 'Delete', icon: <TrashIcon />, onSelect: () => deleteItems([item]) },
    ]
  }

  const closeMenu = useCallback(() => setMenu(null), [])
  const closePreview = useCallback(() => setPreview(null), [])

  // ---- Render ------------------------------------------------------------------------

  if (!validName || fsState.status === 'error') {
    return (
      <FullPageMessage
        title={validName ? 'Couldn’t open this file system' : 'Not a valid file system name'}
        body={
          validName
            ? fsState.error ?? 'Something went wrong.'
            : 'Names are 3–48 characters: lowercase letters, numbers and dashes.'
        }
      />
    )
  }

  const selectedItems = items.filter((i) => selection.has(i.key))
  const totalSize = items.reduce((s, i) => s + (i.size ?? 0), 0)
  const trail = folder?.trail ?? []

  return (
    <div className={`explorer ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <aside className="sidebar">
        <Sidebar
          fs={fs}
          tree={tree}
          currentId={currentId}
          dropTarget={dropTarget}
          pathFor={pathFor}
          onNavigate={() => setSidebarOpen(false)}
        />
      </aside>
      <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />

      <section className="main">
        <header className="toolbar">
          <button className="icon-btn only-mobile" onClick={() => setSidebarOpen(true)} aria-label="Folders">
            <MenuIcon />
          </button>
          <div className="nav-buttons">
            <button className="icon-btn" onClick={() => navigate(-1)} title="Back" disabled={window.history.state?.idx === 0}>
              <ChevronLeft />
            </button>
            <button className="icon-btn" onClick={() => navigate(1)} title="Forward">
              <ChevronRight />
            </button>
            <button
              className="icon-btn"
              onClick={() => parentId && navigate(pathFor(parentId))}
              disabled={!parentId}
              title="Enclosing folder (⌘↑)"
            >
              <ArrowUp />
            </button>
          </div>

          <nav className="pathbar" aria-label="Path">
            {trail.map((t, i) => (
              <span key={t.id} className="path-seg">
                <span className="path-sep">/</span>
                <Link
                  to={pathFor(t.id)}
                  data-drop={t.id}
                  className={[i === 0 && 'root', i === trail.length - 1 && 'current', dropTarget === t.id && 'drop']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="truncate">{t.name}</span>
                </Link>
              </span>
            ))}
          </nav>

          <label className="search">
            <SearchIcon width={15} height={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search this folder" />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <XIcon width={13} height={13} />
              </button>
            )}
          </label>

          <div className="segmented" role="group" aria-label="View">
            <button className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')} title="List">
              <ListIcon width={16} height={16} />
            </button>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => changeView('grid')} title="Icons">
              <GridIcon width={16} height={16} />
            </button>
          </div>

          <button className="icon-btn" onClick={() => setCreating(true)} title="New folder (⇧⌘N)" disabled={!folder}>
            <FolderPlus />
          </button>
          <button className="btn primary" onClick={() => pickFiles(currentId)} disabled={!folder}>
            <UploadIcon width={16} height={16} />
            <span className="hide-sm">Upload</span>
          </button>
        </header>

        <div
          className="view"
          onClick={() => setSelection(new Set())}
          onContextMenu={(e) => {
            if (!folder) return
            e.preventDefault()
            setSelection(new Set())
            setMenu({ x: e.clientX, y: e.clientY, item: null })
          }}
        >
          {folderError ? (
            <div className="view-empty">
              <FolderGlyph size={56} />
              <strong>{folderError === 'missing' ? 'Folder not found' : 'Couldn’t load this folder'}</strong>
              <span className="muted">
                {folderError === 'missing' ? 'It may have been a mistyped link.' : 'Check your connection and try again.'}
              </span>
              <Link to={pathFor(fs)} className="btn">
                Go to {fs}
              </Link>
            </div>
          ) : !folder ? (
            <div className="list">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="row-item skeleton-row">
                  <span className="skeleton" style={{ width: `${30 + ((i * 17) % 40)}%` }} />
                </div>
              ))}
            </div>
          ) : items.length === 0 && !creating ? (
            <div className="view-empty">
              {query ? (
                <>
                  <SearchIcon width={40} height={40} />
                  <strong>No results for “{query}”</strong>
                </>
              ) : (
                <div className="empty-frame">
                  <span className="mono-label">Empty frame</span>
                  <FolderGlyph size={64} />
                  <strong>Nothing in “{folder.name}” yet</strong>
                  <span className="muted">Drop photos and videos anywhere. They’re stored byte-for-byte, never compressed.</span>
                  <div className="row">
                    <button className="btn primary" onClick={(e) => (e.stopPropagation(), pickFiles(currentId))}>
                      <UploadIcon width={16} height={16} /> Upload
                    </button>
                    <button className="btn" onClick={(e) => (e.stopPropagation(), setCreating(true))}>
                      <FolderPlus width={16} height={16} /> New folder
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <FileView
              view={view}
              items={items}
              selection={selection}
              dropTarget={dropTarget}
              sort={sort}
              creating={creating}
              onSort={onSort}
              onItemClick={onItemClick}
              onItemOpen={openItem}
              onItemContext={onItemContext}
              onCreateCommit={commitNewFolder}
              onCreateCancel={() => setCreating(false)}
            />
          )}
        </div>

        {dragging && (
          <div className={`drop-frame ${dropTarget ? 'targeted' : ''}`} aria-hidden>
            <span className="drop-pill">
              <UploadIcon width={15} height={15} /> Release to upload
              <b>→ {(dropTarget && (tree.find((t) => t.id === dropTarget)?.name ?? items.find((i) => i.key === dropTarget)?.name)) || folder?.name || fs}</b>
            </span>
          </div>
        )}

        <footer className="statusbar">
          <span className="readout">
            <span>
              Items <b>{String(items.length).padStart(3, '0')}</b>
            </span>
            <span>
              Sel <b>{String(selectedItems.length).padStart(3, '0')}</b>
            </span>
            <span className="hide-sm">
              Size <b>{formatBytes(totalSize)}</b>
            </span>
          </span>
          <span className={`live ${live ? 'on' : ''}`} title={live ? 'Live — changes from others appear instantly' : 'Connecting…'}>
            <i /> {live ? 'Live' : 'Offline'}
          </span>
        </footer>
      </section>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) enqueue(e.target.files, uploadTarget.current)
          e.target.value = ''
        }}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menuEntries(menu.item)} onClose={closeMenu} />}
      {preview !== null && preview >= 0 && (
        <Lightbox files={previewFiles} index={preview} onIndex={setPreview} onClose={closePreview} />
      )}
      <UploadTray items={uploads} onDismiss={() => setUploads([])} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function FullPageMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="full-message">
      <DriveIcon width={40} height={40} />
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <Link to="/" className="btn primary">
        Choose another
      </Link>
    </div>
  )
}
