import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { fileUrl, type FileEntry } from '../lib/supabase'
import { formatBytes, formatDate } from '../lib/util'
import { ChevronDown, ChevronUp, FileGlyph, FolderGlyph, PlayIcon } from './Icons'

export type Item = {
  key: string
  type: 'folder' | 'picture' | 'video'
  name: string
  size: number | null
  created: string
  kindLabel: string
  file?: FileEntry
}

export type SortKey = 'name' | 'created' | 'size' | 'kind'
export type Sort = { key: SortKey; asc: boolean }

type Props = {
  view: 'list' | 'grid'
  items: Item[]
  selection: Set<string>
  dropTarget: string | null
  sort: Sort
  creating: boolean
  onSort: (key: SortKey) => void
  onItemClick: (e: MouseEvent, item: Item, index: number) => void
  onItemOpen: (item: Item) => void
  onItemContext: (e: MouseEvent, item: Item) => void
  onCreateCommit: (name: string) => void
  onCreateCancel: () => void
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: 'Name', className: 'col-name' },
  { key: 'created', label: 'Date added', className: 'col-date' },
  { key: 'size', label: 'Size', className: 'col-size' },
  { key: 'kind', label: 'Kind', className: 'col-kind' },
]

export function FileView(props: Props) {
  const { view, items, selection, dropTarget, creating, onItemClick, onItemOpen, onItemContext } = props

  const rowProps = (item: Item, index: number) => ({
    id: `item-${item.key}`,
    'data-drop': item.type === 'folder' ? item.key : undefined,
    'aria-selected': selection.has(item.key),
    role: 'row' as const,
    className: [
      view === 'list' ? 'row-item' : 'tile',
      selection.has(item.key) && 'selected',
      item.key === dropTarget && 'drop',
    ]
      .filter(Boolean)
      .join(' '),
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      onItemClick(e, item, index)
    },
    onDoubleClick: () => onItemOpen(item),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onItemContext(e, item)
    },
  })

  if (view === 'grid') {
    return (
      <div className="grid" role="grid" data-grid>
        {creating && <NewFolderInput {...props} />}
        {items.map((item, i) => (
          <div key={item.key} {...rowProps(item, i)}>
            <div className="tile-thumb">
              <Thumb item={item} size={64} large />
            </div>
            <div className="tile-name" title={item.name}>
              <span className="tile-no">{frameNo(i)}</span>
              <span className="tile-title">{item.name}</span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="list" role="grid">
      <div className="list-head" role="row">
        <span className="col-no">No.</span>
        {COLUMNS.map((c) => (
          <button key={c.key} className={`${c.className} ${props.sort.key === c.key ? 'sorted' : ''}`} onClick={() => props.onSort(c.key)}>
            {c.label}
            {props.sort.key === c.key &&
              (props.sort.asc ? <ChevronUp width={12} height={12} strokeWidth={2.4} /> : <ChevronDown width={12} height={12} strokeWidth={2.4} />)}
          </button>
        ))}
      </div>
      {creating && <NewFolderInput {...props} />}
      {items.map((item, i) => (
        <div key={item.key} {...rowProps(item, i)}>
          <span className="col-no">{frameNo(i)}</span>
          <span className="col-name">
            <Thumb item={item} size={20} />
            <span className="truncate">{item.name}</span>
          </span>
          <span className="col-date">{formatDate(item.created)}</span>
          <span className="col-size">{item.type === 'folder' ? '—' : formatBytes(item.size)}</span>
          <span className="col-kind truncate">{item.kindLabel}</span>
        </div>
      ))}
    </div>
  )
}

/** Film edge-print style frame number: 001, 002… */
const frameNo = (i: number) => String(i + 1).padStart(3, '0')

function Thumb({ item, size, large }: { item: Item; size: number; large?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (item.type === 'folder') return <FolderGlyph size={large ? 60 : size} />
  const file = item.file!
  // List view only shows real thumbnails for pictures; loading many videos just for an icon is wasteful.
  if (broken || (!large && item.type === 'video')) return <FileGlyph size={large ? 52 : size} kind={item.type} />

  const src = fileUrl(file.cloudflare)
  return (
    <span className={large ? 'thumb large' : 'thumb'}>
      {item.type === 'picture' ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <>
          <video src={`${src}#t=0.1`} preload="metadata" muted playsInline onError={() => setBroken(true)} />
          <span className="thumb-play">
            <PlayIcon width={9} height={9} />
            {large && <span>{item.name.split('.').pop()?.slice(0, 4)}</span>}
          </span>
        </>
      )}
    </span>
  )
}

function NewFolderInput({ view, onCreateCommit, onCreateCancel }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    const name = ref.current?.value.trim() ?? ''
    if (name) onCreateCommit(name)
    else onCreateCancel()
  }

  const input = (
    <input
      ref={ref}
      className="rename"
      defaultValue="untitled folder"
      maxLength={120}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          done.current = true
          onCreateCancel()
        }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  )

  return view === 'grid' ? (
    <div className="tile selected">
      <div className="tile-thumb">
        <FolderGlyph size={60} />
      </div>
      {input}
    </div>
  ) : (
    <div className="row-item selected">
      <span className="col-no">+</span>
      <span className="col-name">
        <FolderGlyph size={20} />
        {input}
      </span>
    </div>
  )
}
