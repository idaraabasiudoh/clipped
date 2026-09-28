import { useMemo, useState } from 'react'
import type { TreeNode } from '../lib/supabase'
import { ChevronRight, DriveIcon, FolderGlyph, XIcon } from './Icons'

type Props = {
  fs: string
  tree: TreeNode[]
  disabledIds: Set<string>
  onSelect: (folderId: string) => void
  onClose: () => void
}

const parentOf = (node: TreeNode) => {
  const parts = node.path.split('/')
  return parts.length > 2 ? parts[parts.length - 2] : null
}

export function MovePicker({ fs, tree, disabledIds, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([fs]))

  const children = useMemo(() => {
    const map = new Map<string, TreeNode[]>()
    for (const node of tree) {
      const parent = parentOf(node)
      if (!parent) continue
      if (!map.has(parent)) map.set(parent, [])
      map.get(parent)!.push(node)
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return map
  }, [tree])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderNode = (id: string, name: string, depth: number) => {
    const kids = children.get(id) ?? []
    const open = expanded.has(id)
    const isRoot = id === fs
    const disabled = disabledIds.has(id)

    return (
      <li key={id}>
        <div
          className={[
            'mp-row',
            selected === id && 'active',
            disabled && 'disabled',
          ].filter(Boolean).join(' ')}
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          <button
            className={`tree-toggle ${open ? 'open' : ''}`}
            style={{ visibility: kids.length ? 'visible' : 'hidden' }}
            onClick={() => toggle(id)}
          >
            <ChevronRight width={12} height={12} strokeWidth={2.4} />
          </button>
          <button
            className="mp-folder"
            disabled={disabled}
            onClick={() => setSelected(id)}
          >
            {isRoot ? <DriveIcon width={16} height={16} /> : <FolderGlyph size={16} />}
            <span className="truncate">{name}</span>
          </button>
        </div>
        {open && kids.length > 0 && <ul>{kids.map((k) => renderNode(k.id, k.name, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="mp-overlay" onClick={onClose}>
      <div className="mp-dialog" onClick={e => e.stopPropagation()}>
        <header className="mp-header">
          <span>Move to…</span>
          <button className="icon-btn" onClick={onClose}><XIcon width={16} height={16} /></button>
        </header>
        <ul className="mp-tree">{renderNode(fs, fs, 0)}</ul>
        <footer className="mp-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!selected}
            onClick={() => selected && onSelect(selected)}
          >
            Move here
          </button>
        </footer>
      </div>
    </div>
  )
}
