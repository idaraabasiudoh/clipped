import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TreeNode } from '../lib/supabase'
import { ChevronRight, DriveIcon, EjectIcon, FolderGlyph, Logo } from './Icons'

type Props = {
  fs: string
  tree: TreeNode[]
  currentId: string
  dropTarget: string | null
  pathFor: (id: string) => string
  onNavigate: () => void
}

const parentOf = (node: TreeNode) => {
  const parts = node.path.split('/')
  return parts.length > 2 ? parts[parts.length - 2] : null
}

export function Sidebar({ fs, tree, currentId, dropTarget, pathFor, onNavigate }: Props) {
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

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([fs]))

  // Reveal the open folder: expand all its ancestors.
  useEffect(() => {
    const node = tree.find((n) => n.id === currentId)
    if (!node) return
    const ancestors = node.path.split('/').filter(Boolean).slice(0, -1)
    setExpanded((prev) => (ancestors.every((a) => prev.has(a)) ? prev : new Set([...prev, ...ancestors])))
  }, [tree, currentId])

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
    return (
      <li key={id}>
        <div
          className={[
            'tree-row',
            id === currentId && 'active',
            id === dropTarget && 'drop',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: 8 + depth * 14 }}
          data-drop={id}
        >
          <button
            className={`tree-toggle ${open ? 'open' : ''}`}
            style={{ visibility: kids.length ? 'visible' : 'hidden' }}
            onClick={() => toggle(id)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight width={12} height={12} strokeWidth={2.4} />
          </button>
          <Link to={pathFor(id)} className="tree-link" onClick={onNavigate}>
            {isRoot ? <DriveIcon width={16} height={16} /> : <FolderGlyph size={16} />}
            <span className="truncate">{name}</span>
          </Link>
        </div>
        {open && kids.length > 0 && <ul>{kids.map((k) => renderNode(k.id, k.name, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <nav className="sidebar-inner" aria-label="Folders">
      <Link to="/" className="sidebar-logo" title="Switch file system">
        <Logo />
      </Link>
      <div className="sidebar-label mono-label">File system</div>
      <ul className="tree">{renderNode(fs, fs, 0)}</ul>
      <div className="sidebar-foot">
        <dl className="spec">
          <dt>Volume</dt>
          <dd className="truncate">/{fs}</dd>
          <dt>Folders</dt>
          <dd>{String(Math.max(0, tree.length - 1)).padStart(3, '0')}</dd>
        </dl>
        <Link to="/" className="btn eject">
          <EjectIcon width={14} height={14} /> Switch file system
        </Link>
      </div>
    </nav>
  )
}
