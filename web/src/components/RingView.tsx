import { DownloadSimple } from '@phosphor-icons/react'
import cytoscape from 'cytoscape'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { inr, ROLE_TEXT, spanText, toEpoch } from '../format'
import { graphStyle, layeredPositions } from '../graph'
import { useLookTick } from '../look'
import { go } from '../route'
import type { RingResult } from '../types'
import { AccountPanel } from './AccountPanel'
import { Timeline } from './Timeline'

interface Props { seed: string; reasons: Record<string, string> }

const ROLES = ['VICTIM', 'L1', 'L2', 'L3', 'UNKNOWN'] as const
const WINDOW: [number, number] = [toEpoch('2026-09-15 00:00:00'), toEpoch('2026-09-29 23:59:00')]

/** One-click syndicate isolation: the whole connected ring of suspects around an account, no node cap. */
export function RingView({ seed, reasons }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<cytoscape.Core | null>(null)
  const edgesByT = useRef<cytoscape.EdgeSingular[]>([])
  const nodesByT = useRef<cytoscape.NodeSingular[]>([])
  const shownUpTo = useRef(-1)
  const nodesUpTo = useRef(-1)
  const [ring, setRing] = useState<RingResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ms, setMs] = useState(0)
  const [cutoff, setCutoff] = useState(Infinity)
  const [selected, setSelected] = useState<string | null>(seed)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const tick = useLookTick()

  useEffect(() => {
    let live = true
    const t0 = performance.now()
    setRing(null); setErr(null); setSelected(seed); setCutoff(Infinity)
    api.ring(seed).then((r) => { if (live) { setRing(r); setMs(performance.now() - t0) } })
      .catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [seed])

  const times = useMemo(() => (ring ? [...new Set(ring.edges.map((e) => toEpoch(e.first_ts)))].sort((a, b) => a - b) : []), [ring])
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    ring?.nodes.forEach((n) => { m[n.role] = (m[n.role] ?? 0) + 1 })
    return m
  }, [ring])

  useEffect(() => {
    if (!ring || !box.current) return
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
    c.on('tap', 'node', (e) => setSelected(e.target.id()))
    edgesByT.current = c.edges().toArray().sort((a, b) => a.data('t') - b.data('t')) as cytoscape.EdgeSingular[]
    shownUpTo.current = edgesByT.current.length - 1
    nodesByT.current = c.nodes().toArray().sort((a, b) => a.data('first') - b.data('first')) as cytoscape.NodeSingular[]
    nodesUpTo.current = nodesByT.current.length - 1
    c.fit(undefined, 24)
    cy.current = c
    return () => { c.destroy(); cy.current = null }
  }, [ring])

  useEffect(() => {
    const c = cy.current
    if (!c || !ring) return
    c.style([
      ...graphStyle({ animate: false }),
      { selector: 'node', style: { label: 'data(label)', 'font-size': 7, 'min-zoomed-font-size': 9, 'border-width': 1, width: 'data(size)', height: 'data(size)' } },
      { selector: `node[id = "${ring.seed}"]`, style: { 'font-size': 26, 'min-zoomed-font-size': 0, 'font-weight': 700, 'border-width': 3, 'border-color': '#ffffff' } },
      { selector: 'edge', style: { 'curve-style': 'haystack', width: 0.8, label: '', opacity: 0.45, 'target-arrow-shape': 'none' } },
      { selector: '.off', style: { display: 'none' } },
      { selector: 'node.sel', style: { 'border-width': 3, 'border-color': '#1f5fbf' } },
      { selector: '.future', style: { opacity: 0, events: 'no' } },
    ])
  }, [ring, tick])

  // time filter: only touch the edges whose state changes (edges are sorted by time)
  useEffect(() => {
    const c = cy.current, es = edgesByT.current
    if (!c || !es.length) return
    const ns = nodesByT.current
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
    c.batch(() => { c.nodes().removeClass('sel'); if (selected) c.getElementById(selected).addClass('sel') })
  }, [selected, ring])

  const toggle = (r: string) => setHidden((h) => { const n = new Set(h); if (n.has(r)) n.delete(r); else n.add(r); return n })
  const onTrace = useCallback((a: string) => go({ name: 'investigate', account: a, seeds: null }), [])
  const onRing = useCallback((a: string) => go({ name: 'ring', account: a }), [])
  const span = ring?.t_from && ring?.t_to ? toEpoch(ring.t_to) - toEpoch(ring.t_from) : 0

  return (
    <div className={`ringview${selected ? '' : ' solo'}`}>
      <div className="ringmain">
        <section className="sheet">
          <div className="sheet-head">
            <h1>Syndicate around <span className="acct">{seed}</span></h1>
            {ring && <a className="btn primary" href={api.ringExportUrl(seed)}><DownloadSimple /> Export ring (ZIP)</a>}
          </div>
          {ring && (
            <div className="toolbar">
              <span><b>{ring.nodes.length.toLocaleString('en-IN')} accounts</b> · {ring.n_txn.toLocaleString('en-IN')} transfers ·
                {' '}{inr(ring.total_paise)}{span > 0 && <> · active over {spanText(span)}</>}</span>
              <span className="muted small">isolated in {ms.toFixed(0)} ms</span>
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
        {!ring && !err && <p className="muted">Isolating the ring around {seed}…</p>}
        <section className="sheet grow" aria-label="Ring graph">
          <div className="graph" ref={box} role="img" aria-label={ring ? `Ring of ${ring.nodes.length} accounts in columns: victims, collectors, distributors, cash-out` : 'Ring graph'} />
          <div className="statusline">Columns: victims · L1 collectors · L2 distributors · L3 cash-out. Zoom in for account labels; click an account for details.</div>
        </section>
        {ring && times.length > 0 && <Timeline times={times} value={Math.min(cutoff, times[times.length - 1])} onChange={setCutoff} fullRange={WINDOW}
                                               label="Show the ring's transfers up to this minute" />}
      </div>
      {selected && (
        <aside className="sheet side sheet-body" aria-label="Account details">
          <div className="row between" style={{ marginBottom: 6 }}>
            <span className="small muted">{selected === seed ? 'Starting account' : 'Selected account'}</span>
            <button className="btn ghost sm" onClick={() => setSelected(null)}>Close</button>
          </div>
          <AccountPanel account={selected} reasons={reasons} onTrace={onTrace} onRing={onRing} onSelect={setSelected} />
        </aside>
      )}
    </div>
  )
}
