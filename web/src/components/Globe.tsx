import { ArrowCounterClockwise, ArrowsInSimple, Minus, Pause, Play, Plus } from '@phosphor-icons/react'
import { forceRadial } from 'd3-force-3d'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { toEpoch } from '../format'
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

const ROLE_NAME: Record<string, string> = { VICTIM: 'victim', L1: 'L1 collector', L2: 'L2 distributor', L3: 'L3 cash-out', UNKNOWN: 'account' }
const FAR = 1e7                                             // hidden points/segments are parked out of view

function hexRgb(h: string): [number, number, number] {
  let v = h.trim().replace('#', '')
  if (v.length === 3) v = v.split('').map((c) => c + c).join('')   // the build shortens #ffffff to #fff
  const n = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
  return n.some(Number.isNaN) ? [0.5, 0.5, 0.5] : [n[0], n[1], n[2]]
}
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] =>
  [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k]
const toHex = (c: [number, number, number]) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill()
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  return t
}

/** The syndicate as a slowly turning globe. For speed, the whole ring is drawn as two batched objects (one point
 *  cloud, one line set) that never rebuild on hover; only the selected journey uses individual, interactive objects.
 *  Hover and click on the cloud use one cheap ray test; double-clicking any line opens its transfer flow. */
export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ ring, journey, selected, hotLink, hidden, cutoff, onPick, onOpenLink }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const tipEl = useRef<HTMLDivElement>(null)
  const fg = useRef<any>(undefined)                       // eslint-disable-line @typescript-eslint/no-explicit-any
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [spin, setSpin] = useState(true)
  const [recent, setRecent] = useState<Set<string>>(new Set())
  const touched = useRef(false)
  const prevCut = useRef(cutoff)
  const look = useLookName()
  const reduced = prefersReducedMotion()
  const objs = useRef<{ points: THREE.Points; lines: THREE.LineSegments; hover: THREE.LineSegments } | null>(null)
  const pickRef = useRef(onPick); pickRef.current = onPick
  const openRef = useRef(onOpenLink); openRef.current = onOpenLink

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
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    const adj = new Map<string, number[]>()
    links.forEach((l, i) => { for (const a of [l.edge.src, l.edge.dst]) (adj.get(a) ?? adj.set(a, []).get(a)!).push(i) })
    return { nodes, links, index, adj }
  }, [ring])

  const colors = useMemo(() => {
    const bg = cssVar('--sheet'), genz = look === 'genz'
    const role: Record<string, string> = {
      VICTIM: genz ? '#e8ecf4' : '#1d3a8a', L1: cssVar('--l1'), L2: cssVar('--l2'), L3: cssVar('--l3'), UNKNOWN: cssVar('--unknown'),
    }
    return { role, bg, genz, hot: genz ? cssVar('--accent') : '#e0a100', ink: cssVar('--ink'), rule: cssVar('--rule-2') }
  }, [look])

  // ---- the batched ring: one point cloud + one line set, added to the scene once ----
  useEffect(() => {
    const g = fg.current
    if (!g) return
    const scene: THREE.Scene = g.scene()
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.nodes.length * 3), 3))
    pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.nodes.length * 3), 3))
    const tex = dotTexture()
    const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 10, sizeAttenuation: true, vertexColors: true, map: tex, alphaTest: 0.5, transparent: true }))
    const lGeo = new THREE.BufferGeometry()
    lGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.links.length * 6), 3))
    const lines = new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.09, depthWrite: false }))
    const hGeo = new THREE.BufferGeometry()
    hGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 6), 3))
    hGeo.setDrawRange(0, 0)
    const hover = new THREE.LineSegments(hGeo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 }))
    points.renderOrder = 1; hover.renderOrder = 2
    scene.add(lines); scene.add(points); scene.add(hover)
    objs.current = { points, lines, hover }
    return () => {
      scene.remove(lines); scene.remove(points); scene.remove(hover)
      pGeo.dispose(); lGeo.dispose(); hGeo.dispose(); tex.dispose()
      ;(points.material as THREE.Material).dispose(); (lines.material as THREE.Material).dispose(); (hover.material as THREE.Material).dispose()
      objs.current = null
    }
  }, [data])

  const visibleNode = useCallback((n: GNode) => !hidden.has(n.role) && n.first <= cutoff, [hidden, cutoff])
  const lit = journey?.nodes

  /** Write positions (and colours) of the batched objects from the current layout. Cheap: plain typed arrays. */
  const sync = useCallback((withColors = false) => {
    const o = objs.current
    if (!o) return
    const pp = o.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const pc = o.points.geometry.getAttribute('color') as THREE.BufferAttribute
    const bg = hexRgb(colors.bg)
    data.nodes.forEach((n, i) => {
      const show = visibleNode(n) && !(lit && lit.has(n.id)) && n.id !== selected
      pp.setXYZ(i, show ? n.x ?? 0 : FAR, show ? n.y ?? 0 : FAR, show ? n.z ?? 0 : FAR)
      if (withColors) {
        const c = mix(hexRgb(colors.role[n.role] ?? colors.role.UNKNOWN), bg, lit ? (colors.genz ? 0.42 : 0.32) : 0)
        pc.setXYZ(i, c[0], c[1], c[2])
      }
    })
    pp.needsUpdate = true
    if (withColors) pc.needsUpdate = true
    o.points.geometry.computeBoundingSphere()
    const lp = o.lines.geometry.getAttribute('position') as THREE.BufferAttribute
    data.links.forEach((l, i) => {
      const s = l.source as GNode, t = l.target as GNode
      const show = l.t <= cutoff && !hidden.has(s.role) && !hidden.has(t.role)
      lp.setXYZ(2 * i, show ? s.x ?? 0 : FAR, show ? s.y ?? 0 : FAR, show ? s.z ?? 0 : FAR)
      lp.setXYZ(2 * i + 1, show ? t.x ?? 0 : FAR, show ? t.y ?? 0 : FAR, show ? t.z ?? 0 : FAR)
    })
    lp.needsUpdate = true
    o.lines.geometry.computeBoundingSphere()
    ;(o.lines.material as THREE.LineBasicMaterial).color.set(colors.genz ? '#9aa6c6' : '#7d8aa3')
    ;(o.hover.material as THREE.LineBasicMaterial).color.set(colors.hot)
  }, [data, colors, visibleNode, lit, selected, cutoff, hidden])

  useEffect(() => { sync(true) }, [sync])

  // ---- forces, camera, rotation ----
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
    c.enableDamping = true
    c.dampingFactor = 0.12
    const stop = () => { touched.current = true; c.autoRotate = false; setSpin(false) }
    c.addEventListener?.('start', stop)
    return () => c.removeEventListener?.('start', stop)
  }, [data])
  useEffect(() => { const c = fg.current?.controls(); if (c) c.autoRotate = spin && !reduced }, [spin, reduced, data])

  const focus = useCallback((id: string) => {
    const g = fg.current
    const n = data.nodes[data.index.get(id) ?? -1]
    if (!g || !n || n.x === undefined) return
    const cam = g.camera().position, tgt = g.controls()?.target ?? { x: 0, y: 0, z: 0 }
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

  // ---- playback: transfers revealed in this step light up and carry moving money ----
  useEffect(() => {
    const prev = prevCut.current
    prevCut.current = cutoff
    if (reduced || !(cutoff > prev) || !Number.isFinite(prev)) { setRecent(new Set()); return }
    const s = new Set<string>()
    for (const l of data.links) if (l.t > prev && l.t <= cutoff && s.size < 120) s.add(l.key)
    setRecent(s)
  }, [cutoff, data, reduced])

  // ---- the interactive layer: only the journey, the selection and live transfers ----
  const activeNode = useCallback((n: GNode) => visibleNode(n) && (n.id === selected || !!lit?.has(n.id)), [visibleNode, selected, lit])
  const activeLink = useCallback((l: GLink) => {
    const s = l.source as GNode, t = l.target as GNode
    if (!(l.t <= cutoff && !hidden.has(s.role ?? '') && !hidden.has(t.role ?? ''))) return false
    return l.key === hotLink || recent.has(l.key) || !!journey?.links.has(l.key)
  }, [journey, hotLink, recent, cutoff, hidden])
  const nodeColor = useCallback((n: GNode) => colors.role[n.role] ?? colors.role.UNKNOWN, [colors])
  const nodeVal = useCallback((n: GNode) => (n.id === selected ? 14 : n.seed ? 6 : 2.2), [selected])
  const linkColor = useCallback(() => colors.hot, [colors])
  const linkWidth = useCallback((l: GLink) => (l.key === hotLink ? 3 : 1.3), [hotLink])

  // ---- hover / click / double-click on the batched ring (one ray test, throttled to the frame) ----
  const ray = useMemo(() => { const r = new THREE.Raycaster(); r.params.Points = { threshold: 5 }; r.params.Line = { threshold: 2.5 }; return r }, [])
  const hit = useCallback((ev: { clientX: number; clientY: number }, what: 'points' | 'lines') => {
    const g = fg.current, o = objs.current, el = box.current
    if (!g || !o || !el) return null
    const r = el.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), g.camera())
    const h = ray.intersectObject(what === 'points' ? o.points : o.lines, false)[0]
    if (!h) return null
    return what === 'points' ? (h.index ?? null) : h.index !== undefined ? Math.floor(h.index / 2) : null
  }, [ray])

  const showHover = useCallback((i: number | null, ev?: { clientX: number; clientY: number }) => {
    const o = objs.current, tip = tipEl.current, el = box.current
    if (!o || !tip || !el) return
    const hp = o.hover.geometry.getAttribute('position') as THREE.BufferAttribute
    if (i === null) { o.hover.geometry.setDrawRange(0, 0); tip.style.opacity = '0'; el.style.cursor = 'grab'; return }
    const n = data.nodes[i]
    let k = 0
    for (const li of (data.adj.get(n.id) ?? []).slice(0, 600)) {
      const l = data.links[li], s = l.source as GNode, t = l.target as GNode
      if (l.t > cutoff) continue
      hp.setXYZ(2 * k, s.x ?? 0, s.y ?? 0, s.z ?? 0); hp.setXYZ(2 * k + 1, t.x ?? 0, t.y ?? 0, t.z ?? 0); k++
    }
    hp.needsUpdate = true
    o.hover.geometry.setDrawRange(0, k * 2)
    o.hover.geometry.computeBoundingSphere()
    const r = el.getBoundingClientRect()
    tip.textContent = ''
    const b = document.createElement('b'); b.textContent = n.id; tip.appendChild(b)
    tip.appendChild(document.createTextNode(` · ${ROLE_NAME[n.role] ?? n.role} · ${k} link${k === 1 ? '' : 's'} · click to follow`))
    tip.style.transform = `translate(${Math.min((ev?.clientX ?? 0) - r.left + 14, r.width - 260)}px, ${(ev?.clientY ?? 0) - r.top + 14}px)`
    tip.style.opacity = '1'
    el.style.cursor = 'pointer'
  }, [data, cutoff])

  useEffect(() => {
    const el = box.current
    if (!el) return
    let raf = 0, last: PointerEvent | null = null
    const onMove = (e: PointerEvent) => {
      last = e
      if (raf || e.buttons) return                          // never hit-test while dragging
      raf = requestAnimationFrame(() => { raf = 0; if (last) showHover(hit(last, 'points'), last) })
    }
    const onLeave = () => showHover(null)
    const onDbl = (e: MouseEvent) => {
      const li = hit(e, 'lines')
      if (li !== null) openRef.current(data.links[li].edge)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('dblclick', onDbl)
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); el.removeEventListener('dblclick', onDbl); cancelAnimationFrame(raf) }
  }, [hit, showHover, data])

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
        rendererConfig={{ preserveDrawingBuffer: true, antialias: true, powerPreference: 'high-performance' }}
        nodeRelSize={3.4}
        nodeResolution={12}
        nodeVal={nodeVal}
        nodeColor={nodeColor}
        nodeOpacity={1}
        nodeVisibility={activeNode}
        nodeLabel={(n: GNode) => `${n.id} · ${ROLE_NAME[n.role] ?? n.role}`}
        linkVisibility={activeLink}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.85}
        linkDirectionalParticles={(l: GLink) => (reduced ? 0 : recent.has(l.key) ? 2 : colors.genz ? 3 : 2)}
        linkDirectionalParticleWidth={2.6}
        linkDirectionalParticleSpeed={0.009}
        linkDirectionalParticleColor={linkColor}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.92}
        linkDirectionalArrowColor={linkColor}
        enableNodeDrag={false}
        warmupTicks={140}
        cooldownTicks={60}
        onEngineTick={() => sync(false)}
        onEngineStop={() => { sync(false); if (!touched.current) fg.current?.zoomToFit(reduced ? 0 : 500, 12) }}
        onNodeClick={(n: GNode) => onPick(n.id)}
        onLinkClick={(l: GLink) => onOpenLink(l.edge)}
        onBackgroundClick={(e: MouseEvent) => {
          const i = hit(e, 'points')
          if (i !== null) onPick(data.nodes[i].id)
          else if (hit(e, 'lines') === null) onPick(null)     // a click on a line is half of a double-click: keep the selection
        }}
      />
      <div ref={tipEl} className="globe-tip" aria-hidden="true" />
      <div className="graph-tools">
        <button className="icon-btn" onClick={() => zoom(0.75)} aria-label="Zoom in" title="Zoom in"><Plus /></button>
        <button className="icon-btn" onClick={() => zoom(1.3)} aria-label="Zoom out" title="Zoom out"><Minus /></button>
        <button className="icon-btn" onClick={() => fg.current?.zoomToFit(reduced ? 0 : 500, 12)} aria-label="Fit the globe" title="Fit"><ArrowsInSimple /></button>
        <button className="icon-btn" onClick={() => setSpin((s) => !s)} aria-label={spin ? 'Stop rotating' : 'Rotate'} title={spin ? 'Stop rotating' : 'Rotate'}>{spin ? <Pause /> : <Play />}</button>
        <button className="icon-btn" onClick={() => { touched.current = false; onPick(null); fg.current?.zoomToFit(reduced ? 0 : 500, 12) }} aria-label="Reset view" title="Reset"><ArrowCounterClockwise /></button>
      </div>
      <div className="globe-legend" aria-hidden="true">
        {(['VICTIM', 'L1', 'L2', 'L3'] as const).map((r) => <span key={r}><i style={{ background: toHex(hexRgb(colors.role[r])) }} />{ROLE_NAME[r]}</span>)}
        <span><i style={{ background: colors.hot }} />journey / live money</span>
        <span className="muted">double-click a line for its flow</span>
      </div>
    </div>
  )
})
