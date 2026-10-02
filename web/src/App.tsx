import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { DQView } from './components/DQView'
import { FlaggedTable } from './components/FlaggedTable'
import { Investigate } from './components/Investigate'
import { Overview } from './components/Overview'
import { RingView } from './components/RingView'
import { SearchBar } from './components/SearchBar'
import { useLook } from './look'
import { useRoute } from './route'
import type { DQSummary } from './types'

export default function App() {
  const route = useRoute()
  const [look, setLook] = useLook()
  const [stats, setStats] = useState<DQSummary | null>(null)
  const [down, setDown] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const lastTrace = useRef<string | null>(null)
  const lastRing = useRef<string | null>(null)
  if (route.name === 'investigate' && route.account) lastTrace.current = route.account
  if (route.name === 'ring') lastRing.current = route.account

  useEffect(() => {
    api.stats().then(setStats).catch(() => setDown(true))
    api.reasons().then(setReasons).catch(() => setReasons({}))
  }, [])
  useEffect(() => {
    const t = route.name === 'investigate' && route.account ? `${route.account} · trace` : route.name === 'ring' ? `${route.account} · ring` : null
    document.title = t ? `${t} · Abhedya-Chakra` : 'Abhedya-Chakra'
  }, [route])

  const tabs: [string, string, string, boolean][] = [
    ['overview', 'Overview', '#overview', false],
    ['investigate', 'Investigate', lastTrace.current ? `#trace=${lastTrace.current}` : '#investigate', false],
    ['ring', 'Syndicate ring', lastRing.current ? `#ring=${lastRing.current}` : '#ring', !lastRing.current],
    ['flagged', 'Flagged accounts', '#flagged', false],
    ['data', 'Data quality', '#data', false],
  ]
  return (
    <div className="app">
      <header className="top">
        <div className="brand">Abhedya-Chakra<small>money-trail workstation</small></div>
        <SearchBar current={route.name === 'investigate' ? route.account : null} />
        <div className="seg" role="group" aria-label="Look">
          <button aria-pressed={look === 'official'} onClick={() => setLook('official')}>Official</button>
          <button aria-pressed={look === 'briefing'} onClick={() => setLook('briefing')}>Briefing</button>
        </div>
        <div className="dataset" title={stats?.input_sha256}>
          {stats ? <>{stats.rows.toLocaleString('en-IN')} transactions · {stats.accounts.toLocaleString('en-IN')} accounts · file {stats.input_sha256.slice(0, 8)} · offline</>
                 : down ? <span className="error">Engine not reachable</span> : 'Loading…'}
        </div>
      </header>
      <nav className="tabs" aria-label="Screens">
        {tabs.map(([k, label, h, disabled]) => (
          <a key={k} href={h} aria-current={route.name === k ? 'page' : undefined} aria-disabled={disabled || undefined}
             title={disabled ? 'Isolate a ring from any account first (the Ring button on a row)' : undefined}>{label}</a>
        ))}
      </nav>
      <main id="main">
        {route.name === 'overview' && <Overview stats={stats} />}
        {route.name === 'investigate' && <Investigate account={route.account} seeds={route.seeds} reasons={reasons} look={look} />}
        {route.name === 'ring' && <RingView key={route.account} seed={route.account} reasons={reasons} />}
        {route.name === 'flagged' && <FlaggedTable reasons={reasons} role={route.role} bank={route.bank} reason={route.reason} />}
        {route.name === 'data' && <DQView stats={stats} />}
      </main>
    </div>
  )
}


