const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function shortId(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => ALPHABET[b % 62]).join('')
}

export function formatBytes(n: number | null | undefined) {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ---- File system names --------------------------------------------------------

export const FS_NAME_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/

/** Turns free text (or a pasted link) into a file system name as the user types. */
export function toFsName(value: string) {
  const fromLink = value.match(/^https?:\/\/[^/]+\/([^/?#]+)/)
  return (fromLink ? fromLink[1] : value)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
}

// File systems you've opened, so the home page can list them. Per-browser only.
const RECENT_KEY = 'clipped:recent-fs'

export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function rememberFs(name: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...getRecent().filter((n) => n !== name)].slice(0, 6)))
  } catch {
    /* storage unavailable */
  }
}

export function getPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(`clipped:${key}`) as T) ?? fallback
  } catch {
    return fallback
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(`clipped:${key}`, value)
  } catch {
    /* storage unavailable */
  }
}
