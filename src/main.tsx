import './lib/debug'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { createLogger } from './lib/debug'
import { isConfigured } from './lib/supabase'
import { Explorer } from './pages/Explorer'
import { HomePage } from './pages/Home'
import './styles.css'

const log = createLogger('router')

function RouteLogger() {
  const { pathname } = useLocation()
  useEffect(() => log.debug(`Route ${pathname}`), [pathname])
  return null
}

function SetupNotice() {
  return (
    <div className="full-message">
      <h2>Connect Supabase</h2>
      <p className="muted">
        Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, then
        restart the dev server.
      </p>
    </div>
  )
}

if (!isConfigured) log.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <RouteLogger />
        <Routes>
          <Route path="/" element={<HomePage />} />
          {/* One route for root + sub-folders so the explorer (and in-flight uploads) survive navigation */}
          <Route path="/:fs/*" element={<Explorer />} />
        </Routes>
      </BrowserRouter>
    ) : (
      <SetupNotice />
    )}
  </StrictMode>,
)
