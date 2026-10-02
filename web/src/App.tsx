import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { AccountPanel } from './components/AccountPanel'
import { DQView } from './components/DQView'
import { FlaggedTable } from './components/FlaggedTable'
import { Investigate } from './components/Investigate'
import { RingView } from './components/RingView'
import { SearchBar } from './components/SearchBar'
import type { DQSummary, TraceResult } from './types'

type Tab = 'investigate' | 'ring' | 'flagged' | 'data'

export default function App() {
  const [tab, setTab] = useState<Tab>('investigate')
  const [stats, setStats] = useState<DQSummary | null>(null)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [traceErr, setTraceErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wallMs, setWallMs] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [ringSeed, setRingSeed] = useState<string | null>(null)
  const [seeds, setSeeds] = useState<number[] | null>(null)   // disputed transfers (null = all outgoing)

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null))
    api.reasons().then(setReasons).catch(() => setReasons({}))
  }, [])

  const runTrace = useCallback(async (account: string, chosen: number[] | null = null) => {
    setTab('investigate'); setBusy(true); setTraceErr(null); setSelected(null); setSeeds(chosen)
    const t0 = performance.now()
    try {
      const t = await api.trace(account, chosen)
      setWallMs(performance.now() - t0)
      setTrace(t)
      if (t.edges.length === 0) setTraceErr(`No outgoing money found for ${account}.`)
    } catch (e) {
      setTrace(null); setTraceErr(String((e as Error).message))
    } finally { setBusy(false) }
  }, [])

  const openRing = useCallback((a: string) => { setRingSeed(a); setSelected(a); setTab('ring') }, [])
  const openAccount = useCallback((a: string) => { setSelected(a) }, [])

  // shareable links: #trace=ACCOUNT, #ring=ACCOUNT, #flagged, #data. Read on load and whenever the address
  // changes (a link pasted into an open tab, back / forward). Our own updates below use replaceState, which
  // does not fire hashchange, so this cannot loop.
  useEffect(() => {
    const apply = () => {
      const h = decodeURIComponent(window.location.hash.slice(1))
      const [k, v] = h.split('=')
      if (k === 'trace' && v) runTrace(v.split('&')[0])
      else if (k === 'ring' && v) openRing(v)
      else if (k === 'flagged' || k === 'data') setTab(k)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [runTrace, openRing])
  useEffect(() => {
    const h = tab === 'investigate' ? (trace ? `#trace=${trace.victim}` : '') : tab === 'ring' ? `#ring=${ringSeed ?? ''}` : `#${tab}`
    if (window.location.hash !== h) window.history.replaceState(null, '', h || window.location.pathname)
  }, [tab, trace, ringSeed])

  const tabs: [Tab, string][] = [['investigate', 'Investigate'], ['ring', 'Syndicate ring'], ['flagged', 'Flagged accounts'], ['data', 'Data quality']]
  return (
    <div className="app">
      <header>
        <div className="brand">Abhedya-Chakra <span>money-trail workstation</span></div>
        <SearchBar onTrace={runTrace} busy={busy} current={trace?.victim} />
        <div className="meta small">{stats ? <>{stats.rows.toLocaleString('en-IN')} transactions · {stats.accounts.toLocaleString('en-IN')} accounts · offline</> : 'Engine not reachable'}</div>
      </header>
      <nav>
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}
                  disabled={k === 'ring' && !ringSeed}>{label}</button>
        ))}
      </nav>
      <main>
        {tab === 'investigate' && (
          <Investigate trace={trace} error={traceErr} wallMs={wallMs} selected={selected} reasons={reasons} seeds={seeds}
                       onSelect={setSelected} onTrace={runTrace} onRing={openRing} />
        )}
        {tab === 'ring' && ringSeed && (
          <div className="split">
            <RingView seed={ringSeed} onSelect={openAccount} />
            {selected && <aside className="right"><AccountPanel account={selected} reasons={reasons} onTrace={runTrace}
                                                                 onRing={openRing} onSelect={openAccount} /></aside>}
          </div>
        )}
        {tab === 'flagged' && (
          <div className="split">
            <FlaggedTable reasons={reasons} onOpen={openAccount} onRing={openRing} />
            {selected && <aside className="right"><AccountPanel account={selected} reasons={reasons} onTrace={runTrace}
                                                                 onRing={openRing} onSelect={openAccount} /></aside>}
          </div>
        )}
        {tab === 'data' && <DQView stats={stats} />}
      </main>
    </div>
  )
}
