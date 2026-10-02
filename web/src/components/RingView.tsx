import { DownloadSimple, FileText, FlowArrow, Globe as GlobeIcon, TreeStructure } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { api } from '../api'
import { inr, ROLE_TEXT, spanText, toEpoch } from '../format'
import { go } from '../route'
import { journeyOf, ringIndex, victimsReaching, type Hop } from '../ringJourney'
import { safeStorage } from '../store'
import type { GraphEdge, RingResult } from '../types'
import { AccountPanel } from './AccountPanel'
import { EdgeFlow } from './EdgeFlow'
import { Globe, type GlobeHandle } from './Globe'
import { NetFlow } from './NetFlow'
import { Page } from './Page'
import { PanelFrame } from './PanelFrame'
import { RingTrail } from './RingTrail'
import { Timeline } from './Timeline'
import { BankIcon } from './BankIcon'
import { DocsModal } from './DocsModal'

interface Props { seed: string; reasons: Record<string, string> }
type View = 'flow' | 'trail' | 'globe'

const ROLES = ['VICTIM', 'L1', 'L2', 'L3', 'UNKNOWN'] as const
const WINDOW: [number, number] = [toEpoch('2026-09-15 00:00:00'), toEpoch('2026-09-29 23:59:00')]

/** One-click syndicate isolation. Money flow (default): who paid into the chosen account and where its money went,
 *  step by step, sized to the panel. Trail: one victim's money through it, laid out like the trace screen. Globe: the
 *  whole network at once. */
export function RingView({ seed, reasons }: Props) {
  const [ring, setRing] = useState<RingResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ms, setMs] = useState(0)
  const [cutoff, setCutoff] = useState(Infinity)
  const [selected, setSelected] = useState<string | null>(seed)
  const [trail, setTrail] = useState<string[]>([seed])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>(() => { const v = safeStorage.getItem('abhedya.ringView2'); return v === 'trail' || v === 'globe' ? v : 'flow' })
  const [edge, setEdge] = useState<GraphEdge | null>(null)
  const [docs, setDocs] = useState(false)
  const globe = useRef<GlobeHandle>(null)
  const layout = useDefaultLayout({ id: 'ring-h2', storage: safeStorage })

  useEffect(() => {
    let live = true
    const t0 = performance.now()               // the view is keyed by seed, so every network starts from fresh state
    api.ring(seed).then((r) => { if (live) { setRing(r); setMs(performance.now() - t0) } })
      .catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [seed])
  useEffect(() => { safeStorage.setItem('abhedya.ringView2', view) }, [view])

  const ix = useMemo(() => (ring ? ringIndex(ring) : null), [ring])
  const journey = useMemo(() => (ix && selected ? journeyOf(ix, selected) : null), [ix, selected])
  // documents are per complainant: the selected victim, else the largest victim whose money reached this account
  const docVictim = useMemo(() => (ix ? victimsReaching(ix, selected ?? seed)[0]?.account ?? null : null), [ix, selected, seed])
  const times = useMemo(() => (ring ? [...new Set(ring.edges.map((e) => toEpoch(e.first_ts)))].sort((a, b) => a - b) : []), [ring])
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    ring?.nodes.forEach((n) => { m[n.role] = (m[n.role] ?? 0) + 1 })
    return m
  }, [ring])

  const pick = useCallback((id: string | null) => {
    setEdge(null)
    setSelected(id)
    if (id) setTrail((t) => (t[t.length - 1] === id ? t : [...t.slice(-7), id]))
  }, [])
  const toggle = (r: string) => setHidden((h) => { const n = new Set(h); if (n.has(r)) n.delete(r); else n.add(r); return n })
  const span = ring?.t_from && ring?.t_to ? toEpoch(ring.t_to) - toEpoch(ring.t_from) : 0
  const cut = Math.min(cutoff, times[times.length - 1] ?? Infinity)

  return (
    <Page title="Fraud Networks" hi="धोखाधड़ी नेटवर्क"
          desc={<>Who paid into <b className="mono">{seed}</b> and where the money went next.</>}
          actions={<>
            <div className="seg view-switch" role="group" aria-label="Network view">
              <button aria-pressed={view === 'flow'} onClick={() => setView('flow')}><FlowArrow /> Money flow</button>
              <button aria-pressed={view === 'trail'} onClick={() => setView('trail')}><TreeStructure /> Trail</button>
              <button aria-pressed={view === 'globe'} onClick={() => setView('globe')}><GlobeIcon /> Globe</button>
            </div>
            {ring && <a className="btn" href={api.ringExportUrl(seed)}><DownloadSimple /> Export network data (ZIP)</a>}
            {docVictim && <button className="btn cta" onClick={() => setDocs(true)}
                                  title={`FIR draft, case diary and one debit-hold notice per bank, for victim ${docVictim}`}>
              <FileText /> Police reports &amp; freeze notices</button>}
          </>}>
      <section className="gpanel">
        {ring && (
          <div className="toolbar">
            <span><b>{ring.nodes.length.toLocaleString('en-IN')} accounts</b> · {ring.n_txn.toLocaleString('en-IN')} transfers ·
              {' '}{inr(ring.total_paise)}{span > 0 && <> · active over {spanText(span)}</>}</span>
            <span className="muted small">found in {ms.toFixed(0)} ms</span>
            <span style={{ marginLeft: 'auto' }} className="row gap wrap" role="group" aria-label="Show layers">
              {ROLES.filter((r) => counts[r]).map((r) => (
                <label key={r} className="check small"><input type="checkbox" checked={!hidden.has(r)} onChange={() => toggle(r)} />
                  <span className={`key ${r}`} />{ROLE_TEXT[r]} {counts[r].toLocaleString('en-IN')}</label>
              ))}
            </span>
          </div>
        )}
      </section>
      {err && <div className="banner bad" role="alert"><b>{err}</b></div>}
      {!ring && !err && <p className="muted">Finding the network around {seed}…</p>}
      {ring && ix && (
        <div className="net-work">
          <Group orientation="horizontal" id="ring-h2" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
            <Panel id="ring-graph" defaultSize="76%" minSize="30%">
              <PanelFrame label="Network graph" title={view === 'globe' ? 'Every account in the network' : view === 'flow' ? `Money flow around ${selected ?? seed}` : `Money trail through ${seed}`}
                actions={<span className="small muted">{view === 'globe' ? 'Drag to turn · scroll to zoom · click a dot · double-click a link' : view === 'flow' ? 'Point at an account for its amounts · click one to put it in the centre' : 'Point at an account for its amounts · click one for its journey'}</span>}>
                {view === 'globe'
                  ? <div className="globe-box">
                      <Globe ref={globe} ring={ring} journey={journey} selected={selected} hotLink={edge ? `${edge.src}>${edge.dst}` : null}
                             hidden={hidden} cutoff={cut} onPick={pick} onOpenLink={setEdge} />
                    </div>
                  : view === 'flow' ? <NetFlow ix={ix} center={selected ?? seed} hidden={hidden} cutoff={cut} onPick={pick} />
                  : <div className="rt-scroll"><RingTrail ix={ix} seed={seed} mark={selected} cursor={cut} onSelect={pick} /></div>}
              </PanelFrame>
            </Panel>
            <Separator className="sep-v" />
            <Panel id="ring-side" minSize="22%">
              <PanelFrame label="Journey and account" title={edge ? 'Transfer flow' : selected ? 'Money journey' : 'Pick an account'}>
                <div className="sheet-body journey">
                  {edge && <EdgeFlow edge={edge} ix={ix} onBack={() => setEdge(null)} onGo={pick} />}
                  {!edge && <>
                  {trail.length > 1 && (
                    <nav className="crumbs" aria-label="Where you came from">
                      {trail.map((a, i) => (
                        <span key={`${a}-${i}`}>{i > 0 && '›'}<button onClick={() => { setTrail(trail.slice(0, i + 1)); setSelected(a) }}>{a}</button></span>
                      ))}
                    </nav>
                  )}
                  {!selected && <p className="muted">Click any dot to see where its money came from and where it went.</p>}
                  {selected && journey && (
                    <>
                      <p className="small" style={{ margin: '8px 0' }}><b className="acct">{selected}</b> sits on paths through <b>{journey.upstream}</b> accounts
                        upstream and <b>{journey.downstream}</b> downstream (up to 4 hops, in time order).</p>
                      <HopList title={`Money came from (${journey.from.length})`} hops={journey.from} onGo={pick}
                               onFlow={(a) => { const e = (ix.out.get(a) ?? []).find((x) => x.dst === selected); if (e) setEdge(e) }} />
                      <HopList title={`Money went to (${journey.to.length})`} hops={journey.to} onGo={pick}
                               onFlow={(a) => { const e = (ix.out.get(selected) ?? []).find((x) => x.dst === a); if (e) setEdge(e) }} />
                      <div style={{ marginTop: 14 }}>
                        <AccountPanel account={selected} reasons={reasons} onSelect={pick}
                          onTrace={(a) => go({ name: 'investigate', account: a, seeds: null })} onRing={(a) => go({ name: 'ring', account: a })} />
                      </div>
                    </>
                  )}
                  </>}
                </div>
              </PanelFrame>
            </Panel>
          </Group>
        </div>
      )}
      {ring && times.length > 0 && <Timeline times={times} value={cut} onChange={setCutoff} fullRange={WINDOW}
                                             label="Show the network's transfers up to this minute" />}
      {docs && docVictim && <DocsModal victim={docVictim} seeds={null} onClose={() => setDocs(false)} />}
    </Page>
  )
}

function HopList({ title, hops, onGo, onFlow }: { title: string; hops: Hop[]; onGo: (a: string) => void; onFlow: (a: string) => void }) {
  const [all, setAll] = useState(false)
  if (!hops.length) return null
  const shown = all ? hops : hops.slice(0, 6)
  return (
    <>
      <h3>{title}</h3>
      {shown.map((h) => (
        <div key={h.account} className="hop">
          <span className={`key ${h.role}`} aria-hidden="true" />
          <div className="hop-main">
            <div className="hop-top"><span className="acct acct-bank"><BankIcon bank={h.account} size="sm" />{h.account}</span>
              <b className="num">{inr(h.total)}</b></div>
            <div className="small muted">{ROLE_TEXT[h.role] ?? h.role} · {h.n} transfer{h.n === 1 ? '' : 's'} · first {h.first.slice(5, 16)}</div>
            <div className="hop-acts">
              <button className="btn ghost sm" onClick={() => onFlow(h.account)} aria-label={`Transfer flow with ${h.account}`}>Flow</button>
              <button className="btn ghost sm" onClick={() => onGo(h.account)} aria-label={`Go to ${h.account}`}>Go here</button></div>
          </div>
        </div>
      ))}
      {hops.length > 6 && <button className="btn ghost sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${hops.length}`}</button>}
    </>
  )
}
