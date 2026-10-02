import { forceRadial } from 'd3-force-3d'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { toEpoch } from '../format'
import { cssVar, prefersReducedMotion, useLookName } from '../look'
import type { Journey } from '../ringJourney'
import type { RingResult } from '../types'

interface GNode { id: string; role: string; seed: boolean; first: number; x?: number; y?: number; z?: number }
interface GLink { source: string | GNode; target: string | GNode; key: string; t: number }

export interface GlobeHandle { snapshot: () => string | null; focus: (id: string) => void }

interface Props {
  ring: RingResult
  journey: Journey | null
  selected: string | null
  hidden: Set<string>
  cutoff: number
  onPick: (id: string | null) => void
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const ROLE_NAME: Record<string, string> = { VICTIM: 'victim', L1: 'L1 collector', L2: 'L2 distributor', L3: 'L3 cash-out', UNKNOWN: 'account' }

/** The syndicate as a slowly turning globe: force layout pulled onto a sphere, layers by colour, the selected
 *  account's journey lit and everything else dimmed. Reduced motion: no rotation, no camera flights, no particles. */
export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ ring, journey, selected, hidden, cutoff, onPick }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const fg = useRef<any>(undefined)                       // eslint-disable-line @typescript-eslint/no-explicit-any
  const [size, setSize] = useState({ w: 600, h: 400 })
  const fitted = useRef(false)
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
    const links: GLink[] = ring.edges.map((e) => ({ source: e.src, target: e.dst, key: `${e.src}>${e.dst}`, t: toEpoch(e.first_ts) }))
    return { nodes, links }
  }, [ring])

  const colors = useMemo(() => ({
    VICTIM: cssVar('--victim'), L1: cssVar('--l1'), L2: cssVar('--l2'), L3: cssVar('--l3'), UNKNOWN: cssVar('--unknown'),
    dim: look === 'genz' ? '#2a3044' : '#d5dae1', accent: cssVar('--accent'), focus: cssVar('--focus'), bg: cssVar('--sheet'),
    link: look === 'genz' ? 'rgba(160,170,200,0.16)' : 'rgba(60,72,90,0.16)', hot: look === 'genz' ? cssVar('--accent') : cssVar('--focus'),
  }), [look])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = fg.current
    if (!g) return
    g.d3Force('radial', forceRadial(150).strength(0.9))      // every account pulled onto one shell: a globe
    g.d3Force('charge')?.strength(-6)
    g.d3Force('link')?.distance(30).strength(0.02)
    g.cameraPosition({ x: 0, y: 0, z: 620 })                 // start outside the globe; refit when the layout settles
    const c = g.controls()
    if (c) {
      c.autoRotate = !reduced
      c.autoRotateSpeed = 0.7
      const stop = () => { c.autoRotate = false }
      c.addEventListener?.('start', stop)
      return () => c.removeEventListener?.('start', stop)
    }
  }, [data, reduced])

  const focus = useCallback((id: string) => {
    const g = fg.current
    const n = data.nodes.find((x) => x.id === id)
    if (!g || !n || n.x === undefined) return
    const d = 320, len = Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1, k = 1 + d / len
    g.cameraPosition({ x: n.x * k, y: (n.y ?? 0) * k, z: (n.z ?? 0) * k }, { x: n.x, y: n.y, z: n.z }, reduced ? 0 : 900)
  }, [data, reduced])

  useImperativeHandle(ref, () => ({
    snapshot: () => { try { return fg.current?.renderer().domElement.toDataURL('image/png') ?? null } catch { return null } },
    focus,
  }), [focus])

  // fly to an account only when the user picks one; the opening view shows the whole globe
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (selected) focus(selected)
  }, [selected, focus])

  const lit = journey?.nodes
  const nodeColor = useCallback((n: GNode) => {
    if (n.id === selected) return colors.hot
    if (lit && !lit.has(n.id)) return colors.dim
    return (colors as Record<string, string>)[n.role] ?? colors.UNKNOWN
  }, [lit, selected, colors])
  const linkColor = useCallback((l: GLink) => (journey?.links.has(l.key) ? colors.hot : colors.link), [journey, colors])
  const linkWidth = useCallback((l: GLink) => (journey?.links.has(l.key) ? 1.4 : 0), [journey])
  const particles = useCallback((l: GLink) => (look === 'genz' && !reduced && journey?.links.has(l.key) ? 2 : 0), [journey, look, reduced])
  const nodeVis = useCallback((n: GNode) => !hidden.has(n.role) && n.first <= cutoff, [hidden, cutoff])
  const linkVis = useCallback((l: GLink) => {
    const s = l.source as GNode, t = l.target as GNode
    return l.t <= cutoff && !hidden.has(s.role ?? '') && !hidden.has(t.role ?? '')
  }, [hidden, cutoff])

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
        nodeRelSize={3.2}
        nodeResolution={8}
        nodeVal={(n: GNode) => (n.seed ? 10 : n.role === 'VICTIM' ? 0.6 : 1.2)}
        nodeColor={nodeColor}
        nodeOpacity={0.95}
        nodeLabel={(n: GNode) => `<div style="font:12px var(--mono);padding:4px 6px;background:${colors.bg};color:${cssVar('--ink')};border:1px solid ${cssVar('--rule-2')};border-radius:6px">${esc(n.id)}<br>${esc(ROLE_NAME[n.role] ?? n.role)}</div>`}
        nodeVisibility={nodeVis}
        linkVisibility={linkVis}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.5}
        linkDirectionalParticles={particles}
        linkDirectionalParticleWidth={2.2}
        linkDirectionalParticleSpeed={0.008}
        linkDirectionalParticleColor={() => colors.hot}
        enableNodeDrag={false}
        warmupTicks={140}
        cooldownTicks={60}
        onEngineStop={() => { if (!fitted.current) { fitted.current = true; fg.current?.zoomToFit(reduced ? 0 : 500, 12) } }}
        onNodeClick={(n: GNode) => onPick(n.id)}
        onBackgroundClick={() => onPick(null)}
      />
    </div>
  )
})
