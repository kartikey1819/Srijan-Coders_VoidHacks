import { CaretDoubleLeft, CaretDoubleRight, ChartBar, Graph, MagnifyingGlass, Moon, Path, ShieldStar, Sun, UserFocus } from '@phosphor-icons/react'
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react'
import { api } from './api'
import { FlaggedTable } from './components/FlaggedTable'
import { MultiTrace } from './components/MultiTrace'
import { NetworkStart } from './components/NetworkStart'
import { Overview } from './components/Overview'
import { TracePage } from './components/TracePage'
import { useTheme } from './look'
import { useRoute, type Route } from './route'
import type { DatasetInfo, DQSummary } from './types'

const RingView = lazy(() => import('./components/RingView').then((m) => ({ default: m.RingView })))

const NAV: { name: Route['name']; label: string; hi: string; icon: ComponentType<{ size?: number }> }[] = [
  { name: 'overview', label: 'Dashboard', hi: 'डैशबोर्ड', icon: ChartBar },
  { name: 'investigate', label: 'Trace Victim Funds', hi: 'पीड़ित राशि का पता लगाएँ', icon: Path },
  { name: 'flagged', label: 'Suspect Accounts', hi: 'संदिग्ध खाते', icon: UserFocus },
  { name: 'ring', label: 'Fraud Networks', hi: 'धोखाधड़ी नेटवर्क', icon: Graph },
]

export default function App() {
  const route = useRoute()
  const [theme, setTheme] = useTheme()
  const [sideMin, setSideMin] = useState(() => { try { return localStorage.getItem('abhedya.sideMin') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('abhedya.sideMin', sideMin ? '1' : '0') } catch { /* ignore */ } }, [sideMin])
  const [stats, setStats] = useState<DQSummary | null>(null)
  const [down, setDown] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [sets, setSets] = useState<DatasetInfo[]>([])
  const lastTrace = useRef<string | null>(null)
  const lastRing = useRef<string | null>(null)
  if (route.name === 'investigate' && route.account) lastTrace.current = route.account
  if (route.name === 'ring' && route.account) lastRing.current = route.account

  useEffect(() => {
    api.stats().then(setStats).catch(() => setDown(true))
    api.reasons().then(setReasons).catch(() => setReasons({}))
    api.datasets().then(setSets).catch(() => setSets([]))
    const refresh = () => api.datasets().then(setSets).catch(() => undefined)
    window.addEventListener('abhedya:datasets', refresh)
    return () => window.removeEventListener('abhedya:datasets', refresh)
  }, [])
  useEffect(() => {
    const t = route.name === 'investigate' && route.account ? `${route.account} · trace`
      : route.name === 'ring' && route.account ? `${route.account} · network` : null
    document.title = t ? `${t} · Abhedya-Chakra` : 'Abhedya-Chakra · Cyber Crime Cell'
  }, [route])
  useEffect(() => { document.getElementById('main')?.scrollTo({ top: 0 }) }, [route.name])

  const switchTo = (id: string) => api.activate(id).then(() => { window.location.hash = '#overview'; window.location.reload() })
  const active = sets.find((d) => d.active)
  const hrefOf = (n: Route['name']) => n === 'investigate' ? (lastTrace.current ? `#trace=${lastTrace.current}` : '#investigate')
    : n === 'ring' ? (lastRing.current ? `#ring=${lastRing.current}` : '#ring') : `#${n}`

  return (
    <div className={`gov${sideMin ? ' side-min' : ''}`}>
      <header className="mast">
        <div className="tricolour" aria-hidden="true" />
        <div className="mast-row">
          <div className="crest" aria-hidden="true"><ShieldStar size={24} weight="fill" /></div>
          <div className="org">
            <div className="org-name">Indore Police Commissionerate · Cyber Crime Cell</div>
            <div className="org-hi" lang="hi">इंदौर पुलिस कमिश्नरेट · साइबर अपराध प्रकोष्ठ</div>
            <div className="org-sys">Abhedya-Chakra · Financial fraud and mule account analysis system</div>
          </div>
          <div className="mast-right">
            <MastSearch />
            <button className="theme-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                    aria-label={theme === 'light' ? 'Switch to night theme' : 'Switch to day theme'}
                    title={theme === 'light' ? 'Day theme · click for night' : 'Night theme · click for day'}>
              {theme === 'light' ? <Sun size={18} weight="bold" /> : <Moon size={18} weight="bold" />}</button>
            <Clock />
            <span className="official">For official use only</span>
          </div>
        </div>
      </header>
      <div className="shell">
        <nav className="side" aria-label="Main menu">
          <div className="side-top"><span className="side-sec">MENU</span>
            <button className="side-toggle" onClick={() => setSideMin((m) => !m)} aria-expanded={!sideMin}
                    aria-label={sideMin ? 'Expand the menu' : 'Collapse the menu to icons'} title={sideMin ? 'Expand the menu' : 'Collapse the menu'}>
              {sideMin ? <CaretDoubleRight size={16} /> : <CaretDoubleLeft size={16} />}</button></div>
          {NAV.map((n) => (
            <a key={n.name} href={hrefOf(n.name)} title={sideMin ? n.label : undefined} aria-label={sideMin ? n.label : undefined} className="side-btn" aria-current={route.name === n.name || (route.name === 'multi' && n.name === 'investigate') ? 'page' : undefined}>
              <n.icon size={20} /><span>{n.label}<small lang="hi">{n.hi}</small></span>
            </a>
          ))}
          <div className="side-foot">
            <div className="sf-title">Open case</div>
            {sets.length > 1 ? (
              <select value={active?.id ?? ''} onChange={(e) => switchTo(e.target.value)} aria-label="Open case" title={active?.name}>
                {sets.filter((d) => d.status === 'done').map((d) => (
                  <option key={d.id} value={d.id}>{d.name.replace(/\.csv$/i, '')}</option>
                ))}
              </select>
            ) : <div className="sf-file" title={active?.name}>{active?.name.replace(/\.csv$/i, '') ?? ''}</div>}
            {stats ? (
              <dl className="sf-stats" title={`File fingerprint (SHA-256) ${stats.input_sha256}`}>
                <div><dt>Transactions</dt><dd>{stats.rows.toLocaleString('en-IN')}</dd></div>
                <div><dt>Accounts</dt><dd>{stats.accounts.toLocaleString('en-IN')}</dd></div>
              </dl>
            ) : down ? <div className="sf-bad">The analysis engine is not reachable.</div> : <div>Loading…</div>}
            <div className="sf-note">Offline · data stays on this computer</div>
          </div>
        </nav>
        <main id="main">
          <div className="screen" key={route.name}>
            {route.name === 'overview' && <Overview stats={stats} />}
            {route.name === 'investigate' && <TracePage account={route.account} seeds={route.seeds} reasons={reasons} />}
            {route.name === 'multi' && <MultiTrace accounts={route.accounts} />}
            {route.name === 'flagged' && <FlaggedTable reasons={reasons} role={route.role} bank={route.bank} reason={route.reason} />}
            {route.name === 'ring' && (route.account ? (
              <Suspense fallback={<div className="gpage"><p className="muted">Loading the network view…</p></div>}>
                <RingView key={route.account} seed={route.account} reasons={reasons} />
              </Suspense>
            ) : <NetworkStart />)}
          </div>
        </main>
      </div>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(id) }, [])
  return (
    <div className="mclock" aria-label="Date and time">
      <b>{now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</b>
      <span>{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</span>
    </div>
  )
}

/** Search any account number from anywhere: Enter (or a suggestion) traces it. */
function MastSearch() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const s = q.trim().toUpperCase()
    if (s.length < 3) { setHits([]); return }
    const id = window.setTimeout(() => api.search(s).then((h) => setHits(h.slice(0, 8))).catch(() => setHits([])), 150)
    return () => window.clearTimeout(id)
  }, [q])
  const goTrace = (a: string) => { setQ(''); setHits([]); window.location.hash = `#trace=${a.trim().toUpperCase()}` }
  return (
    <form className="msearch" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) goTrace(q) }}>
      <MagnifyingGlass size={16} aria-hidden="true" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account number" aria-label="Search account number"
             onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} spellCheck={false} autoComplete="off" />
      {open && hits.length > 0 && (
        <ul className="suggest" aria-label="Matching accounts">
          {hits.map((h) => <li key={h}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => goTrace(h)}>{h}</button></li>)}
        </ul>
      )}
    </form>
  )
}
