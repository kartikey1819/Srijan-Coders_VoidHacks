import { Camera, DownloadSimple, Globe as GlobeIcon, Rows } from '@phosphor-icons/react'
import cytoscape from 'cytoscape'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { api } from '../api'
import { inr, ROLE_TEXT, spanText, toEpoch } from '../format'
import { graphStyle, layeredPositions } from '../graph'
import { cssVar, useThemeTick } from '../look'
import { go } from '../route'
import { journeyOf, ringIndex, type Hop } from '../ringJourney'
import { safeStorage } from '../store'
import type { GraphEdge, RingResult } from '../types'
import { AccountPanel } from './AccountPanel'
import { EdgeFlow } from './EdgeFlow'
import { Globe, type GlobeHandle } from './Globe'
import { Page } from './Page'
import { PanelFrame } from './PanelFrame'
import { Timeline } from './Timeline'

interface Props { seed: string; reasons: Record<string, string> }
type View = 'globe' | 'columns'

const ROLES = ['VICTIM', 'L1', 'L2', 'L3', 'UNKNOWN'] as const
const WINDOW: [number, number] = [toEpoch('2026-09-15 00:00:00'), toEpoch('2026-09-29 23:59:00')]

/** One-click syndicate isolation. Globe (default) to see the whole ring and follow one account's journey;
 *  Columns to read the exact Victim | L1 | L2 | L3 layers. */
export function RingView({ seed, reasons }: Props) {
  const [ring, setRing] = useState<RingResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ms, setMs] = useState(0)
  const [cutoff, setCutoff] = useState(Infinity)
  const [selected, setSelected] = useState<string | null>(seed)
  const [trail, setTrail] = useState<string[]>([seed])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>(() => (safeStorage.getItem('abhedya.ringView') === 'columns' ? 'columns' : 'globe'))
  const [sha, setSha] = useState('')
  const [edge, setEdge] = useState<GraphEdge | null>(null)
  const globe = useRef<GlobeHandle>(null)
  const cols = useRef<{ snapshot: () => string | null }>(null)
  const layout = useDefaultLayout({ id: 'ring-h', storage: safeStorage })

  useEffect(() => {
    let live = true
    const t0 = performance.now()
    setRing(null); setErr(null); setSelected(seed); setTrail([seed]); setCutoff(Infinity)
    api.ring(seed).then((r) => { if (live) { setRing(r); setMs(performance.now() - t0) } })
      .catch((e) => live && setErr(String(e.message ?? e)))
    api.stats().then((s) => live && setSha(s.input_sha256)).catch(() => undefined)
    return () => { live = false }
  }, [seed])
  useEffect(() => { safeStorage.setItem('abhedya.ringView', view) }, [view])

  const ix = useMemo(() => (ring ? ringIndex(ring) : null), [ring])
  const journey = useMemo(() => (ix && selected ? journeyOf(ix, selected) : null), [ix, selected])
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
  const snapshot = () => {
    const url = view === 'globe' ? globe.current?.snapshot() : cols.current?.snapshot()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `ring_${seed}_${sha.slice(0, 8) || 'data'}_${view}.png`
    a.click()
  }
  const span = ring?.t_from && ring?.t_to ? toEpoch(ring.t_to) - toEpoch(ring.t_from) : 0
  const cut = Math.min(cutoff, times[times.length - 1] ?? Infinity)

  return (
    <Page title="Fraud Networks" hi="धोखाधड़ी नेटवर्क"
          desc={<>Every suspect account linked by money to <b className="mono">{seed}</b>: its victims, collectors, distributors and cash-out accounts. Click a dot to follow its money.</>}
          actions={<>
            <div className="seg view-switch" role="group" aria-label="Network view">
              <button aria-pressed={view === 'globe'} onClick={() => setView('globe')}><GlobeIcon /> Globe</button>
              <button aria-pressed={view === 'columns'} onClick={() => setView('columns')}><Rows /> Columns</button>
            </div>
            {ring && <button className="btn" onClick={snapshot}><Camera /> Picture (PNG)</button>}
            {ring && <a className="btn primary" href={api.ringExportUrl(seed)}><DownloadSimple /> Export network data (ZIP)</a>}
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
          <Group orientation="horizontal" id="ring-h" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
            <Panel id="ring-graph" defaultSize="64%" minSize="30%">
              <PanelFrame label="Network graph" title={view === 'globe' ? 'Every account in the network' : 'Victims · Collectors · Distributors · Cash-out'}
                actions={<span className="small muted">{view === 'globe' ? 'Drag to turn · scroll to zoom · click a dot · double-click a link' : 'Click an account · double-click a link'}</span>}>
                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  {view === 'globe'
                    ? <Globe ref={globe} ring={ring} journey={journey} selected={selected} hotLink={edge ? `${edge.src}>${edge.dst}` : null}
                             hidden={hidden} cutoff={cut} onPick={pick} onOpenLink={setEdge} />
                    : <Columns ref={cols} ring={ring} selected={selected} hidden={hidden} cutoff={cut} onPick={pick} journey={journey?.nodes ?? null}
                               onOpenLink={setEdge} />}
                </div>
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
          <div><div className="acct">{h.account}</div>
            <div className="small muted">{ROLE_TEXT[h.role] ?? h.role} · {h.bank} · {h.n} transfer{h.n === 1 ? '' : 's'} · first {h.first.slice(5, 16)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="num">{inr(h.total)}</div>
            <div className="row gap" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost sm" onClick={() => onFlow(h.account)} aria-label={`Transfer flow with ${h.account}`}>Flow</button>
              <button className="btn ghost sm" onClick={() => onGo(h.account)} aria-label={`Go to ${h.account}`}>Go here</button></div></div>
        </div>
      ))}
      {hops.length > 6 && <button className="btn ghost sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${hops.length}`}</button>}
    </>
  )
}

interface ColProps { ring: RingResult; selected: string | null; hidden: Set<string>; cutoff: number; onPick: (a: string | null) => void; journey: Set<string> | null; onOpenLink: (e: GraphEdge) => void }

/** The strict layered view: victims | L1 | L2 | L3 columns. Scrubbing touches only elements whose state changes. */
const Columns = forwardRef<{ snapshot: () => string | null }, ColProps>(function Columns({ ring, selected, hidden, cutoff, onPick, journey, onOpenLink }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<cytoscape.Core | null>(null)
  const edgesByT = useRef<cytoscape.EdgeSingular[]>([])
  const nodesByT = useRef<cytoscape.NodeSingular[]>([])
  const shownUpTo = useRef(-1)
  const nodesUpTo = useRef(-1)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const openRef = useRef(onOpenLink)
  openRef.current = onOpenLink
  const tick = useThemeTick()

  useImperativeHandle(ref, () => ({ snapshot: () => cy.current?.png({ full: false, scale: 2, bg: cssVar('--sheet') }) ?? null }), [])

  useEffect(() => {
    if (!box.current) return
    const pos = layeredPositions(ring.nodes.map((n) => ({ id: n.account, role: n.role, order: n.account })),
      { colGap: 260, rowGap: 22, maxRows: 60, subGap: 70 })
    const first = new Map<string, number>()
    for (const e of ring.edges) {
      const t = toEpoch(e.first_ts)
      for (const a of [e.src, e.dst]) first.set(a, Math.min(first.get(a) ?? Infinity, t))
    }
    const c = cytoscape({
      container: box.current, minZoom: 0.05, maxZoom: 3, boxSelectionEnabled: false,
      textureOnViewport: true, hideEdgesOnViewport: ring.edges.length > 1500,
      elements: [
        ...ring.nodes.map((n) => ({ group: 'nodes' as const, position: pos[n.account],
          data: { id: n.account, role: n.role, first: first.get(n.account) ?? 0, label: n.account === ring.seed ? `${n.account}\nstarting account` : n.account, size: n.account === ring.seed ? 40 : 11 } })),
        ...ring.edges.map((e) => ({ group: 'edges' as const, data: { id: `${e.src}>${e.dst}`, source: e.src, target: e.dst, t: toEpoch(e.first_ts) } })),
      ],
      layout: { name: 'preset' },
    })
    c.on('tap', 'node', (e) => pickRef.current(e.target.id()))
    c.on('tap', (e) => { if (e.target === c) pickRef.current(null) })
    const byKey = new Map(ring.edges.map((e) => [`${e.src}>${e.dst}`, e]))
    c.on('dbltap', 'edge', (e) => { const g = byKey.get(e.target.id()); if (g) openRef.current(g) })
    edgesByT.current = c.edges().toArray().sort((a, b) => a.data('t') - b.data('t')) as cytoscape.EdgeSingular[]
    nodesByT.current = c.nodes().toArray().sort((a, b) => a.data('first') - b.data('first')) as cytoscape.NodeSingular[]
    shownUpTo.current = edgesByT.current.length - 1
    nodesUpTo.current = nodesByT.current.length - 1
    c.fit(undefined, 24)
    cy.current = c
    const ro = new ResizeObserver(() => { c.resize() })
    ro.observe(box.current)
    return () => { ro.disconnect(); c.destroy(); cy.current = null }
  }, [ring])

  useEffect(() => {
    const c = cy.current
    if (!c) return
    c.style([
      ...graphStyle({ animate: false }),
      { selector: 'node', style: { label: 'data(label)', 'font-size': 7, 'min-zoomed-font-size': 9, 'border-width': 1, width: 'data(size)', height: 'data(size)' } },
      { selector: `node[id = "${ring.seed}"]`, style: { 'font-size': 26, 'min-zoomed-font-size': 0, 'font-weight': 700, 'border-width': 3 } },
      { selector: 'edge', style: { 'curve-style': 'haystack', width: 0.8, label: '', opacity: 0.45, 'target-arrow-shape': 'none' } },
      { selector: '.off', style: { display: 'none' } },
      { selector: '.faint', style: { opacity: 0.12 } },
      { selector: 'node.sel', style: { 'border-width': 3, 'border-color': cssVar('--focus') } },
      { selector: '.future', style: { opacity: 0, events: 'no' } },
    ])
  }, [ring, tick])

  useEffect(() => {
    const c = cy.current, es = edgesByT.current, ns = nodesByT.current
    if (!c || !es.length) return
    const upTo = <T extends cytoscape.SingularElementArgument>(arr: T[], key: string) => {
      let k = -1, lo = 0, hi = arr.length - 1
      while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].data(key) <= cutoff) { k = m; lo = m + 1 } else hi = m - 1 }
      return k
    }
    const k = upTo(es, 't'), kn = upTo(ns, 'first')
    const prev = shownUpTo.current, prevN = nodesUpTo.current
    c.batch(() => {
      if (k > prev) for (let i = prev + 1; i <= k; i++) es[i].removeClass('future')
      else for (let i = k + 1; i <= prev; i++) es[i].addClass('future')
      if (kn > prevN) for (let i = prevN + 1; i <= kn; i++) ns[i].removeClass('future')
      else for (let i = kn + 1; i <= prevN; i++) ns[i].addClass('future')
    })
    shownUpTo.current = k
    nodesUpTo.current = kn
  }, [cutoff, ring])

  useEffect(() => {
    const c = cy.current
    if (!c) return
    c.batch(() => c.nodes().forEach((n) => { n.toggleClass('off', hidden.has(n.data('role'))) }))
  }, [hidden, ring])

  useEffect(() => {
    const c = cy.current
    if (!c) return
    c.batch(() => {
      c.elements().removeClass('sel faint')
      if (selected) c.getElementById(selected).addClass('sel')
      if (journey) c.nodes().forEach((n) => { if (!journey.has(n.id())) n.addClass('faint') })
    })
  }, [selected, journey, ring])

  return <div className="graph" ref={box} style={{ position: 'absolute', inset: 0 }} role="img"
              aria-label={`Ring of ${ring.nodes.length} accounts in columns: victims, collectors, distributors, cash-out`} />
})
