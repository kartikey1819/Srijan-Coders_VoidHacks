import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { DQView } from './components/DQView'
import { FlaggedTable } from './components/FlaggedTable'
import { Home } from './components/Home'
import { Investigate } from './components/Investigate'
import { Overview } from './components/Overview'
import { SearchBar } from './components/SearchBar'
import { useLook } from './look'
import { useRoute } from './route'
import type { DatasetInfo, DQSummary } from './types'

const RingView = lazy(() => import('./components/RingView').then((m) => ({ default: m.RingView })))

export default function App() {
  const route = useRoute()
  const [look, setLook] = useLook()
  const [stats, setStats] = useState<DQSummary | null>(null)
  const [down, setDown] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [sets, setSets] = useState<DatasetInfo[]>([])
  const lastTrace = useRef<string | null>(null)
  const lastRing = useRef<string | null>(null)
  if (route.name === 'investigate' && route.account) lastTrace.current = route.account
  if (route.name === 'ring') lastRing.current = route.account

  useEffect(() => {
    api.stats().then(setStats).catch(() => setDown(true))
    api.reasons().then(setReasons).catch(() => setReasons({}))
    api.datasets().then(setSets).catch(() => setSets([]))
    const refresh = () => api.datasets().then(setSets).catch(() => undefined)
    window.addEventListener('abhedya:datasets', refresh)
    return () => window.removeEventListener('abhedya:datasets', refresh)
  }, [])
  useEffect(() => {
    const t = route.name === 'investigate' && route.account ? `${route.account} · trace` : route.name === 'ring' ? `${route.account} · ring` : null
    document.title = t ? `${t} · Abhedya-Chakra` : 'Abhedya-Chakra'
  }, [route])

  const switchTo = (id: string) => api.activate(id).then(() => { window.location.hash = '#overview'; window.location.reload() })
  const active = sets.find((d) => d.active)
  const tabs: [string, string, string, boolean][] = [
    ['home', 'Home', '#home', false],
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
          <button aria-pressed={look === 'genz'} onClick={() => setLook('genz')}>Gen-Z</button>
        </div>
        <div className="dataset" title={stats?.input_sha256}>
          {sets.length > 1 ? (
            <label className="dsw">Case
              <select value={active?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="Active dataset">
                {sets.filter((d) => d.status === 'done').map((d) => (
                  <option key={d.id} value={d.id}>{d.id === 'official' ? 'Official dataset' : d.name} · {d.rows.toLocaleString('en-IN')} rows</option>
                ))}
              </select>
            </label>
          ) : null}
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
        <div className="screen" key={route.name} style={{ minHeight: "100%" }}>
          {route.name === 'home' && <Home stats={stats} />}
          {route.name === 'overview' && <Overview stats={stats} />}
          {route.name === 'investigate' && <Investigate account={route.account} seeds={route.seeds} reasons={reasons} look={look} />}
          {route.name === 'ring' && (
            <Suspense fallback={<div className="page"><p className="muted">Loading the ring view…</p></div>}>
              <RingView key={route.account} seed={route.account} reasons={reasons} />
            </Suspense>
          )}
          {route.name === 'flagged' && <FlaggedTable reasons={reasons} role={route.role} bank={route.bank} reason={route.reason} />}
          {route.name === 'data' && <DQView stats={stats} />}
        </div>
      </main>
    </div>
  )
}
