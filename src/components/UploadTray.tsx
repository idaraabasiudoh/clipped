import { formatBytes } from '../lib/util'
import { CheckIcon, XIcon } from './Icons'

export type UploadItem = {
  key: string
  name: string
  size: number
  progress: number
  status: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
  cancel?: () => void
}

type Props = { items: UploadItem[]; onDismiss: () => void }

export function UploadTray({ items, onDismiss }: Props) {
  if (!items.length) return null
  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading')
  const failed = items.filter((i) => i.status === 'error').length
  const total = items.reduce((s, i) => s + i.size, 0)
  const sent = items.reduce((s, i) => s + i.size * (i.status === 'done' ? 1 : i.progress), 0)
  const overall = total ? sent / total : 0

  return (
    <aside className="tray">
      <header className="tray-head">
        <div>
          <strong>
            {active.length
              ? `Uploading ${active.length} of ${items.length}`
              : failed
                ? `${failed} upload${failed > 1 ? 's' : ''} failed`
                : 'All uploads complete'}
          </strong>
          <span className="muted">
            {formatBytes(sent)} / {formatBytes(total)} · byte-for-byte
          </span>
        </div>
        {!active.length && (
          <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
            <XIcon width={18} height={18} />
          </button>
        )}
      </header>
      <div className="bar">
        <span style={{ transform: `scaleX(${overall})` }} />
      </div>
      <ul className="tray-list">
        {items.map((i) => (
          <li key={i.key} className={`tray-item ${i.status}`}>
            <span className="truncate">{i.name}</span>
            <span className="tray-status">
              {i.status === 'done' && <CheckIcon width={14} height={14} strokeWidth={2.4} />}
              {i.status === 'uploading' && `${String(Math.round(i.progress * 100)).padStart(3, '0')}%`}
              {i.status === 'queued' && 'Wait'}
              {i.status === 'error' && <span title={i.error}>{i.error === 'Cancelled' ? 'Void' : 'Err'}</span>}
              {(i.status === 'queued' || i.status === 'uploading') && i.cancel && (
                <button className="link-btn" onClick={i.cancel}>
                  Cancel
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
