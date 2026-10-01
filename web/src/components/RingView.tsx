import cytoscape from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { inr, ROLE_TEXT, toEpoch } from '../format'
import { baseStyle, layeredPositions } from '../graph'
import type { RingResult } from '../types'
import { TimeSlider } from './TimeSlider'

interface Props { seed: string; onSelect: (a: string) => void }

/** One-click syndicate isolation: the whole connected ring of suspects around an account, no node cap. */
export function RingView({ seed, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const cy = useRef<cytoscape.Core | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect
  const [ring, setRing] = useState<RingResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ms, setMs] = useState(0)
  const [cutoff, setCutoff] = useState(Infinity)

  useEffect(() => {
    let live = true
    const t0 = performance.now()
    setRing(null); setErr(null)
    api.ring(seed).then((r) => { if (live) { setRing(r); setMs(performance.now() - t0) } })
      .catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [seed])

  const range = useMemo<[number, number]>(() => {
    if (!ring || ring.edges.length === 0) return [0, 0]
    const ts = ring.edges.map((e) => toEpoch(e.first_ts))
    return [Math.min(...ts), Math.max(...ts)]
  }, [ring])

  useEffect(() => { setCutoff(range[1]) }, [range])

  useEffect(() => {
    if (!ring || !box.current) return
    const pos = layeredPositions(ring.nodes.map((n) => ({ id: n.account, role: n.role, order: n.account })),
      { colGap: 260, rowGap: 22, maxRows: 60, subGap: 70 })
    const c = cytoscape({
      container: box.current, pixelRatio: 1, minZoom: 0.05, maxZoom: 3, boxSelectionEnabled: false,
      textureOnViewport: true, hideEdgesOnViewport: ring.edges.length > 1500,
      style: [
        ...baseStyle,
        { selector: 'node', style: { label: 'data(id)', 'font-size': 7, 'min-zoomed-font-size': 9, width: 10, height: 10 } },
        { selector: 'edge', style: { 'curve-style': 'haystack', width: 0.7, label: '', opacity: 0.55, 'target-arrow-shape': 'none' } },
      ],
      elements: [
        ...ring.nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.account, role: n.role, band: n.risk_band }, position: pos[n.account] })),
        ...ring.edges.map((e) => ({ group: 'edges' as const, data: { id: `${e.src}>${e.dst}`, source: e.src, target: e.dst, t: toEpoch(e.first_ts) } })),
      ],
      layout: { name: 'preset' },
    })
    c.on('tap', 'node', (e) => select.current(e.target.id()))
    const s = c.getElementById(ring.seed)
    if (s.nonempty()) s.addClass('sel')
    c.fit(undefined, 20)
    cy.current = c
    return () => { c.destroy(); cy.current = null }
  }, [ring])

  useEffect(() => {
    const c = cy.current
    if (!c) return
    c.batch(() => c.edges().forEach((e) => { e.toggleClass('future', e.data('t') > cutoff) }))
  }, [cutoff])

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    ring?.nodes.forEach((n) => { m[n.role] = (m[n.role] ?? 0) + 1 })
    return m
  }, [ring])

  return (
    <div className="ring">
      <div className="row between toolbar">
        <div>
          <b>Syndicate around <span className="mono">{seed}</span></b>
          {ring && <span className="muted small"> · {ring.nodes.length.toLocaleString('en-IN')} accounts · {ring.n_txn.toLocaleString('en-IN')} transfers ·
            {' '}{inr(ring.total_paise)} · loaded in {ms.toFixed(0)} ms</span>}
        </div>
        {ring && <a className="btn primary" href={api.ringExportUrl(seed)}>Export ring (ZIP)</a>}
      </div>
      {ring && (
        <div className="legend small">
          {(['VICTIM', 'L1', 'L2', 'L3', 'UNKNOWN'] as const).filter((r) => counts[r]).map((r) =>
            <span key={r}><span className={`dot ${r}`} />{ROLE_TEXT[r]} {counts[r]}</span>)}
          <span className="muted">Columns: victims · collectors · distributors · cash-out. Click an account for details.</span>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {!ring && !err && <p className="muted">Isolating ring…</p>}
      <div className="graph big" ref={box} />
      {ring && ring.edges.length > 0 && <TimeSlider min={range[0]} max={range[1]} value={Math.min(cutoff, range[1])} onChange={setCutoff} />}
    </div>
  )
}
