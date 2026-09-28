// Namespaced debug logging.
//
// debug/info output is on in `npm run dev`, when VITE_DEBUG=true, or after running
// `clippedDebug.enable()` in the browser console (persists in localStorage).
// warn/error always print. The last 500 entries (all levels) are kept in memory —
// `clippedDebug.dump()` prints them, `clippedDebug.copy()` copies them for a bug report.

type Level = 'debug' | 'info' | 'warn' | 'error'
type Entry = { t: string; level: Level; ns: string; msg: string; data?: unknown }

const STORAGE_KEY = 'clipped:debug'
const MAX_ENTRIES = 500
const entries: Entry[] = []

function storedFlag() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

let enabled =
  storedFlag() === '1' || (storedFlag() !== '0' && (import.meta.env.DEV || import.meta.env.VITE_DEBUG === 'true'))

const COLORS = ['#ff5a36', '#2f80ed', '#22a06b', '#9b51e0', '#e2a300', '#00a3bf', '#eb5757']
const colorFor = (ns: string) => COLORS[[...ns].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length]

function record(level: Level, ns: string, msg: string, data?: unknown) {
  entries.push({ t: new Date().toISOString(), level, ns, msg, data })
  if (entries.length > MAX_ENTRIES) entries.shift()
  if (!enabled && (level === 'debug' || level === 'info')) return
  const args: unknown[] = [`%c${ns}%c ${msg}`, `color:${colorFor(ns)};font-weight:600`, 'color:inherit']
  if (data !== undefined) args.push(data)
  console[level](...args)
}

export type Logger = ReturnType<typeof createLogger>

export function createLogger(ns: string) {
  return {
    debug: (msg: string, data?: unknown) => record('debug', ns, msg, data),
    info: (msg: string, data?: unknown) => record('info', ns, msg, data),
    warn: (msg: string, data?: unknown) => record('warn', ns, msg, data),
    error: (msg: string, data?: unknown) => record('error', ns, msg, data),
    /** Starts a timer; call the returned function to get elapsed ms. */
    timer: () => {
      const start = performance.now()
      return () => Math.round(performance.now() - start)
    },
  }
}

const api = {
  enable() {
    enabled = true
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    return 'Clipped debug logs on'
  },
  disable() {
    enabled = false
    try { localStorage.setItem(STORAGE_KEY, '0') } catch { /* ignore */ }
    return 'Clipped debug logs off'
  },
  get enabled() {
    return enabled
  },
  entries: () => [...entries],
  dump() {
    console.table(entries.map(({ t, level, ns, msg }) => ({ t, level, ns, msg })))
  },
  async copy() {
    await navigator.clipboard.writeText(JSON.stringify(entries, null, 2))
    return `Copied ${entries.length} log entries`
  },
}

declare global {
  interface Window {
    clippedDebug: typeof api
  }
}
window.clippedDebug = api

const log = createLogger('app')
window.addEventListener('error', (e) => log.error('Uncaught error', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => log.error('Unhandled promise rejection', e.reason))
if (enabled) log.info('Debug logging on — clippedDebug.disable() to turn off, clippedDebug.dump() to review')
