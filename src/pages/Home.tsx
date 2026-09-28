import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Logo } from '../components/Icons'
import { createLogger } from '../lib/debug'
import { FS_NAME_RE, getRecent, toFsName } from '../lib/util'

const log = createLogger('home')
const pad = (n: number) => String(n).padStart(2, '0')

export function HomePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const recent = getRecent()
  const valid = FS_NAME_RE.test(name)

  useEffect(() => {
    document.title = 'Clipped'
  }, [])

  function open(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid) {
      log.debug('Rejected file system name', { name })
      return
    }
    log.info(`Opening file system "${name}"`)
    navigate(`/${name}`)
  }

  return (
    <div className="home">
      <div className="viewfinder" aria-hidden>
        <i /> <i /> <i /> <i />
      </div>

      <header className="home-top">
        <Logo />
        <span className="mono-label">Shared file system — photo &amp; video</span>
      </header>

      <main className="home-main">
        <p className="mono-label">
          <span className="rec" /> No accounts · original quality · live
        </p>
        <h1 className="display">
          Every frame,
          <br />
          <span className="chrome-text">one link.</span>
        </h1>
        <p className="lede">
          Name a file system to open it. If it doesn’t exist, it’s made on the spot. Share the link, and anyone can add
          folders, photos and videos. Nothing gets compressed.
        </p>

        <form onSubmit={open} className="home-form">
          <label className={`address ${touched && !valid ? 'invalid' : ''}`}>
            <span className="address-host">{location.host}/</span>
            <input
              value={name}
              onChange={(e) => setName(toFsName(e.target.value))}
              onBlur={() => name && setTouched(true)}
              placeholder="your-name-here"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="File system name"
            />
            <button className="btn primary lg" disabled={!name}>
              Open <ArrowRight width={16} height={16} />
            </button>
          </label>
          <p className={`hint ${touched && !valid ? 'error' : ''}`}>
            {touched && !valid ? '✕ ' : ''}3–48 characters: a–z, 0–9 and dashes
          </p>
        </form>

        {recent.length > 0 && (
          <section className="recent">
            <h2 className="mono-label">Recently opened</h2>
            <ol>
              {recent.map((fs, i) => (
                <li key={fs}>
                  <Link to={`/${fs}`} className="recent-row">
                    <span className="recent-no">{pad(i + 1)}</span>
                    <span className="recent-name">{fs}</span>
                    <span className="recent-leader" />
                    <ArrowRight width={14} height={14} />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>

      <footer className="home-foot mono-label">
        <span>Byte-for-byte uploads</span>
        <span>Folders inside folders</span>
        <span>Drag · drop · done</span>
      </footer>
    </div>
  )
}
