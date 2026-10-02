import { ArrowCounterClockwise, ArrowsInSimple, Minus, Pause, Play, Plus } from '@phosphor-icons/react'
import { forceRadial } from 'd3-force-3d'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { inrShort, toEpoch } from '../format'
import { cssVar, prefersReducedMotion, useLookName } from '../look'
import type { Journey } from '../ringJourney'
import type { GraphEdge, RingResult } from '../types'

interface GNode { id: string; role: string; seed: boolean; first: number; x?: number; y?: number; z?: number }
interface GLink { source: string | GNode; target: string | GNode; key: string; t: number; edge: GraphEdge }

export interface GlobeHandle { snapshot: () => string | null; focus: (id: string) => void }

interface Props {
  ring: RingResult
  journey: Journey | null
  selected: string | null
  hotLink: string | null
  hidden: Set<string>
  cutoff: number
  onPick: (id: string | null) => void
  onOpenLink: (e: GraphEdge) => void
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const ROLE_NAME: Record<string, string> = { VICTIM: 'victim', L1: 'L1 collector', L2: 'L2 distributor', L3: 'L3 cash-out', UNKNOWN: 'account' }

/** Blend a hex colour toward the background: keeps the hue (layer stays recognisable) while receding. */
function fade(hex: string, bg: string, k: number): string {
  const p = (h: string) => {
    let v = h.trim().replace('#', '')
    if (v.length === 3) v = v.split('').map((c) => c + c).join('')      // the build shortens #ffffff to #fff
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
  }
  try {
    const a = p(hex), b = p(bg)
    if ([...a, ...b].some((x) => Number.isNaN(x))) return hex
    return '#' + a.map((x, i) => Math.round(x * (1 - k) + b[i] * k).toString(16).padStart(2, '0')).join('')
  } catch { return hex }
}

/** The syndicate as a slowly turning globe: every account pulled onto one sphere, coloured by layer.
 *  Click a dot: its money journey lights up and flows. Hover: its direct links. Double-click a link: the transfer
 *  flow behind it. The camera never zooms out on its own once the user has moved it. */
export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ ring, journey, selected, hotLink, hidden, cutoff, onPick, onOpenLink }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const fg = useRef<any>(undefined)                       // eslint-disable-line @typescript-eslint/no-explicit-any
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [hover, setHover] = useState<string | null>(null)
  const [spin, setSpin] = useState(true)
  const touched = useRef(false)                            // user moved the camera: no more automatic fitting
  const lastClick = useRef<{ key: string; t: number } | null>(null)
  const prevCut = useRef(cutoff)
  const look = useLookName()
  const reduced = prefersReducedMotion()

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const first = new Map<string, number>()
    for (const e of ring.edges) {
      const t = toEpoch(e.first_ts)
      for (const a of [e.src, e.dst]) first.set(a, Math.min(first.get(a) ?? Infinity, t))
    }
    const nodes: GNode[] = ring.nodes.map((n) => ({ id: n.account, role: n.role, seed: n.account === ring.seed, first: first.get(n.account) ?? 0 }))
    const links: GLink[] = ring.edges.map((e) => ({ source: e.src, target: e.dst, key: `${e.src}>${e.dst}`, t: toEpoch(e.first_ts), edge: e }))
    return { nodes, links }
  }, [ring])

  const colors = useMemo(() => {
    const bg = cssVar('--sheet'), genz = look === 'genz'
    const role: Record<string, string> = {
      VICTIM: genz ? '#e8ecf4' : '#1d3a8a', L1: cssVar('--l1'), L2: cssVar('--l2'), L3: cssVar('--l3'), UNKNOWN: cssVar('--unknown'),
    }
    const faded: Record<string, string> = Object.fromEntries(Object.entries(role).map(([k, v]) => [k, fade(v, bg, genz ? 0.62 : 0.55)]))
    return { role, faded, bg, hot: genz ? cssVar('--accent') : '#e0a100', link: genz ? 'rgba(160,170,200,0.18)' : 'rgba(40,52,72,0.16)',
             ink: cssVar('--ink'), rule: cssVar('--rule-2') }
  }, [look])

  // forces: pull every account onto one shell; start outside it; never auto-fit after the user has moved
  useEffect(() => {
    const g = fg.current
    if (!g) return
    g.d3Force('radial', forceRadial(150).strength(0.9))
    g.d3Force('charge')?.strength(-6)
    g.d3Force('link')?.distance(30).strength(0.02)
    g.cameraPosition({ x: 0, y: 0, z: 620 })
    const c = g.controls()
    if (!c) return
    c.autoRotateSpeed = 0.6
    const stop = () => { touched.current = true; c.autoRotate = false; setSpin(false) }
    c.addEventListener?.('start', stop)
    return () => c.removeEventListener?.('start', stop)
  }, [data])
  useEffect(() => { const c = fg.current?.controls(); if (c) c.autoRotate = spin && !reduced }, [spin, reduced, data])

  /** Bring a node to the centre, keeping the current zoom (distance), approaching from outside the globe. */
  const focus = useCallback((id: string) => {
    const g = fg.current
    const n = data.nodes.find((x) => x.id === id)
    if (!g || !n || n.x === undefined) return
    const cam = g.camera().position, c = g.controls()
    const tgt = c?.target ?? { x: 0, y: 0, z: 0 }
    const dist = Math.min(900, Math.max(80, Math.hypot(cam.x - tgt.x, cam.y - tgt.y, cam.z - tgt.z)))
    const len = Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1
    const u = { x: n.x / len, y: (n.y ?? 0) / len, z: (n.z ?? 0) / len }
    g.cameraPosition({ x: n.x + u.x * dist, y: (n.y ?? 0) + u.y * dist, z: (n.z ?? 0) + u.z * dist }, { x: n.x, y: n.y, z: n.z }, reduced ? 0 : 700)
  }, [data, reduced])

  useImperativeHandle(ref, () => ({
    snapshot: () => { try { return fg.current?.renderer().domElement.toDataURL('image/png') ?? null } catch { return null } },
    focus,
  }), [focus])

  const firstSel = useRef(true)
  useEffect(() => {
    if (firstSel.current) { firstSel.current = false; return }
    if (selected) { touched.current = true; focus(selected) }
  }, [selected, focus])

  // playback: money visibly travels along each newly revealed transfer
  useEffect(() => {
    const g = fg.current, prev = prevCut.current
    prevCut.current = cutoff
    if (!g || reduced || !(cutoff > prev) || !Number.isFinite(prev)) return
    let n = 0
    for (const l of data.links) {
      if (l.t > prev && l.t <= cutoff && n < 80) { g.emitParticle(l); n++ }
    }
  }, [cutoff, data, reduced])

  const hoverSet = useMemo(() => {
    if (!hover) return null
    const s = new Set<string>([hover])
    for (const l of data.links) {
      const a = typeof l.source === 'object' ? l.source.id : l.source, b = typeof l.target === 'object' ? l.target.id : l.target
      if (a === hover) s.add(b)
      if (b === hover) s.add(a)
    }
    return s
  }, [hover, data])

  const lit = journey?.nodes
  const nodeColor = useCallback((n: GNode) => {
    const on = hoverSet ? hoverSet.has(n.id) : !lit || lit.has(n.id)
    return on ? colors.role[n.role] ?? colors.role.UNKNOWN : colors.faded[n.role] ?? colors.faded.UNKNOWN
  }, [lit, hoverSet, colors])
  const nodeVal = useCallback((n: GNode) => (n.id === selected ? 14 : n.id === hover ? 6 : n.seed ? 8 : n.role === 'VICTIM' ? 0.7 : 1.3), [selected, hover])
  const linkOn = useCallback((l: GLink) => {
    if (l.key === hotLink) return true
    if (hover) { const a = (l.source as GNode).id, b = (l.target as GNode).id; return a === hover || b === hover }
    return !!journey?.links.has(l.key)
  }, [journey, hover, hotLink])
  const linkColor = useCallback((l: GLink) => (linkOn(l) ? colors.hot : colors.link), [linkOn, colors])
  const linkWidth = useCallback((l: GLink) => (l.key === hotLink ? 3 : linkOn(l) ? 1.4 : 0), [linkOn, hotLink])
  const particles = useCallback((l: GLink) => (!reduced && linkOn(l) ? (look === 'genz' ? 3 : 2) : 0), [linkOn, look, reduced])
  const nodeVis = useCallback((n: GNode) => !hidden.has(n.role) && n.first <= cutoff, [hidden, cutoff])
  const linkVis = useCallback((l: GLink) => {
    const s = l.source as GNode, t = l.target as GNode
    return l.t <= cutoff && !hidden.has(s.role ?? '') && !hidden.has(t.role ?? '')
  }, [hidden, cutoff])

  const tip = (html: string) => `<div style="font:12px/1.4 var(--font);padding:6px 8px;background:${colors.bg};color:${colors.ink};border:1px solid ${colors.rule};border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.18)">${html}</div>`
  const zoom = (k: number) => {
    const g = fg.current
    if (!g) return
    touched.current = true
    const cam = g.camera().position, t = g.controls()?.target ?? { x: 0, y: 0, z: 0 }
    g.cameraPosition({ x: t.x + (cam.x - t.x) * k, y: t.y + (cam.y - t.y) * k, z: t.z + (cam.z - t.z) * k }, undefined, reduced ? 0 : 300)
  }

  return (
    <div ref={box} className="globe" data-nodes={data.nodes.length} data-testid="ring-globe">
      <ForceGraph3D
        ref={fg}
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor={colors.bg}
        showNavInfo={false}
        controlType="orbit"
        rendererConfig={{ preserveDrawingBuffer: true, antialias: true }}
        nodeRelSize={3.4}
        nodeResolution={10}
        nodeVal={nodeVal}
        nodeColor={nodeColor}
        nodeOpacity={1}
        nodeLabel={(n: GNode) => tip(`<b style="font-family:var(--mono)">${esc(n.id)}</b><br>${esc(ROLE_NAME[n.role] ?? n.role)}<br><span style="opacity:.7">click to follow its money</span>`)}
        nodeVisibility={nodeVis}
        linkVisibility={linkVis}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.6}
        linkHoverPrecision={6}
        linkLabel={(l: GLink) => tip(`<b style="font-family:var(--mono)">${esc(l.edge.src)} → ${esc(l.edge.dst)}</b><br>${esc(inrShort(l.edge.total_paise))} in ${l.edge.n_txn} transfer${l.edge.n_txn === 1 ? '' : 's'} · first ${esc(l.edge.first_ts.slice(5, 16))}<br><span style="opacity:.7">double-click for the full flow</span>`)}
        linkDirectionalParticles={particles}
        linkDirectionalParticleWidth={2.6}
        linkDirectionalParticleSpeed={0.009}
        linkDirectionalParticleColor={() => colors.hot}
        linkDirectionalArrowLength={(l: GLink) => (linkOn(l) ? 4 : 0)}
        linkDirectionalArrowRelPos={0.92}
        linkDirectionalArrowColor={() => colors.hot}
        enableNodeDrag={false}
        warmupTicks={140}
        cooldownTicks={60}
        onEngineStop={() => { if (!touched.current) fg.current?.zoomToFit(reduced ? 0 : 500, 12) }}
        onNodeHover={(n: GNode | null) => { setHover(n ? n.id : null); if (box.current) box.current.style.cursor = n ? 'pointer' : 'grab' }}
        onLinkHover={(l: GLink | null) => { if (box.current) box.current.style.cursor = l ? 'pointer' : 'grab' }}
        onNodeClick={(n: GNode) => onPick(n.id)}
        onLinkClick={(l: GLink) => {
          const now = performance.now(), prev = lastClick.current
          lastClick.current = { key: l.key, t: now }
          if (prev && prev.key === l.key && now - prev.t < 400) { lastClick.current = null; onOpenLink(l.edge) }
        }}
        onBackgroundClick={() => onPick(null)}
      />
      <div className="graph-tools">
        <button className="icon-btn" onClick={() => zoom(0.75)} aria-label="Zoom in" title="Zoom in"><Plus /></button>
        <button className="icon-btn" onClick={() => zoom(1.3)} aria-label="Zoom out" title="Zoom out"><Minus /></button>
        <button className="icon-btn" onClick={() => fg.current?.zoomToFit(reduced ? 0 : 500, 12)} aria-label="Fit the globe" title="Fit"><ArrowsInSimple /></button>
        <button className="icon-btn" onClick={() => setSpin((s) => !s)} aria-label={spin ? 'Stop rotating' : 'Rotate'} title={spin ? 'Stop rotating' : 'Rotate'}>{spin ? <Pause /> : <Play />}</button>
        <button className="icon-btn" onClick={() => { touched.current = false; onPick(null); fg.current?.zoomToFit(reduced ? 0 : 500, 12) }} aria-label="Reset view" title="Reset"><ArrowCounterClockwise /></button>
      </div>
      <div className="globe-legend" aria-hidden="true">
        {(['VICTIM', 'L1', 'L2', 'L3'] as const).map((r) => <span key={r}><i style={{ background: colors.role[r] }} />{ROLE_NAME[r]}</span>)}
        <span><i style={{ background: colors.hot }} />selected journey</span>
      </div>
    </div>
  )
})
