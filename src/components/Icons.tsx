import { useId, type SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (props: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

/** Silver folder: a darker tab behind a brushed-chrome front. */
export const FolderGlyph = ({ size = 20 }: { size?: number }) => {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="folder-glyph">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--chrome-1)" />
          <stop offset="0.48" stopColor="var(--chrome-2)" />
          <stop offset="0.52" stopColor="var(--chrome-3)" />
          <stop offset="1" stopColor="var(--chrome-4)" />
        </linearGradient>
      </defs>
      <path d="M4 11a3 3 0 0 1 3-3h11.2a3 3 0 0 1 2.2 1L23.5 12H41a3 3 0 0 1 3 3v3H4z" fill="var(--folder-tab)" />
      <path d="M4 17a2 2 0 0 1 2-2h36a2 2 0 0 1 2 2v21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill={`url(#${id})`} stroke="var(--folder-edge)" strokeWidth="1" />
      <path d="M5 18.5h38" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
    </svg>
  )
}

/** A mounted frame with a picture or film mark — for files without a thumbnail. */
export const FileGlyph = ({ size = 20, kind }: { size?: number; kind: 'picture' | 'video' }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="file-glyph">
    <rect x="6" y="6" width="36" height="36" rx="3" fill="var(--paper-2)" stroke="var(--line-strong)" strokeWidth="1.5" />
    {kind === 'video' ? (
      <>
        {[12, 19, 26, 33].map((x) => (
          <g key={x} fill="var(--ink-3)">
            <rect x={x} y="10" width="3" height="3" rx="0.6" />
            <rect x={x} y="35" width="3" height="3" rx="0.6" />
          </g>
        ))}
        <path d="M20.5 18.5v11l9-5.5z" fill="var(--ink)" />
      </>
    ) : (
      <>
        <circle cx="30" cy="17" r="3" fill="var(--ink-3)" />
        <path d="M11 35l9.5-11 6 7 4-4.5L37 35z" fill="var(--ink)" />
      </>
    )}
  </svg>
)

/** Four crop marks around a point — the brand mark. */
export const CropMark = (p: P) => (
  <svg {...base({ strokeWidth: 2.2, strokeLinecap: 'square', ...p })}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

export const DriveIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M5 13l2.2-6.6A2 2 0 0 1 9.1 5h5.8a2 2 0 0 1 1.9 1.4L19 13" /><path d="M7 16.5h.01M10 16.5h.01" strokeWidth={2.4} /></svg>
)
export const FolderPlus = (p: P) => (
  <svg {...base(p)}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M12 11v5M9.5 13.5h5" /></svg>
)
export const UploadIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 16V4M7 9l5-5 5 5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></svg>
)
export const LinkIcon = (p: P) => (
  <svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)
export const XIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const ChevronLeft = (p: P) => (
  <svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>
)
export const ChevronRight = (p: P) => (
  <svg {...base(p)}><path d="M9 5l7 7-7 7" /></svg>
)
export const ChevronDown = (p: P) => (
  <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>
)
export const ChevronUp = (p: P) => (
  <svg {...base(p)}><path d="M6 15l6-6 6 6" /></svg>
)
export const ArrowUp = (p: P) => (
  <svg {...base(p)}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
)
export const ArrowRight = (p: P) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const DownloadIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
)
export const EyeIcon = (p: P) => (
  <svg {...base(p)}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
)
export const PlayIcon = (p: P) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z" /></svg>
)
export const ListIcon = (p: P) => (
  <svg {...base(p)}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>
)
export const GridIcon = (p: P) => (
  <svg {...base(p)}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>
)
export const SearchIcon = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></svg>
)
export const MenuIcon = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
)
export const RefreshIcon = (p: P) => (
  <svg {...base(p)}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></svg>
)
export const EjectIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 5l7 8H5z" /><path d="M5 18h14" /></svg>
)
export const Logo = () => (
  <span className="logo">
    <span className="logo-mark">
      <CropMark width={15} height={15} />
    </span>
    <span className="logo-word">clipped</span>
  </span>
)
