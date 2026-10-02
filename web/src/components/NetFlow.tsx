import { useEffect, useMemo, useRef, useState } from 'react'
import { inr, inrShort, toEpoch } from '../format'
import type { ringIndex } from '../ringJourney'
import type { GraphEdge } from '../types'

type Ix = ReturnType<typeof ringIndex>
const BH = 46, ROW = 56, TOP = 46, PAD = 14, GAP = 36, BW_MAX = 188, BW_MIN = 124
const roleVar = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()})` : r === 'VICTIM' ? 'var(--victim)' : 'var(--unknown)')
const roleBg = (r: string) => (r === 'L1' || r === 'L2' || r === 'L3' ? `var(--${r.toLowerCase()}-bg)` : r === 'VICTIM' ? 'var(--victim-bg)' : 'var(--unknown-bg)')
const PLURAL: Record<string, string> = { VICTIM: 'Victims', L1: 'Collectors', L2: 'Distributors', L3: 'Cash-out', UNKNOWN: 'Other' }
const ONE: Record<string, string> = { VICTIM: 'victim', L1: 'collector (Layer 1)', L2: 'distributor (Layer 2)', L3: 'cash-out (Layer 3)', UNKNOWN: 'other account' }

interface Col { step: number; ids: string[]; more: number }
interface Node { id: string; role: string; step: number; amount: number; t: number }

/** Width and height of an element, tracked. */
function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, number, number] {
  const ref = useRef<T>(null)
  const [s, setS] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setS({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, s.w, s.h]
}

/**
 * The money flow around one account of the network, left to right: who paid into it, then where its money went, step
 * by step (time-respecting, up to three steps). Line thickness is the amount. Sized to its panel: each column shows as
 * many accounts as fit (largest first) and folds the rest into "+N more"; boxes narrow to fit the width. Click an
 * account to put it in the centre.
 */
export function NetFlow({ ix, center, hidden, cutoff, onPick }: {
  ix: Ix; center: string; hidden: Set<string>; cutoff: number; onPick: (a: string) => void
}) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [hover, setHover] = useState<string | null>(null)
  const [ref, width] = useSize<HTMLDivElement>()
  useEffect(() => { setOpen(new Set()) }, [center])
  const flow = useMemo(() => buildFlow(ix, center, hidden), [ix, center, hidden])
  const fit = 7                                                          // accounts per column before "+N more"
  const cols: Col[] = useMemo(() => flow.steps.map((step) => {
    const ids = flow.byStep.get(step) ?? []
    const show = open.has(step) || ids.length <= fit ? ids : ids.slice(0, fit - 1)
    return { step, ids: show, more: ids.length - show.length }
  }), [flow, open, fit])
  const nCols = cols.length
  const BW = Math.max(BW_MIN, Math.min(BW_MAX, Math.floor((width - 2 * PAD - (nCols - 1) * GAP) / Math.max(1, nCols))))
  const W = Math.max(width, 2 * PAD + nCols * BW + (nCols - 1) * GAP)
  const colX = (i: number) => PAD + (i * (W - 2 * PAD - BW)) / Math.max(1, nCols - 1)
  const rows = Math.max(1, ...cols.map((c) => c.ids.length + (c.more ? 1 : 0)))
  const H = TOP + rows * ROW
  const pos = new Map<string, { x: number; y: number }>()
  cols.forEach((c, ci) => {
    const n = c.ids.length + (c.more ? 1 : 0), off = ((rows - n) * ROW) / 2
    c.ids.forEach((id, i) => pos.set(id, { x: colX(ci), y: TOP + off + i * ROW }))
    if (c.more) pos.set(`more:${c.step}`, { x: colX(ci), y: TOP + off + c.ids.length * ROW })
  })
  const maxAmt = Math.max(1, ...flow.links.map((l) => l.e.total_paise))
  const shownLinks = flow.links.map((l) => {
    const fs = flow.nodes.get(l.from)?.step, ts = flow.nodes.get(l.to)?.step
    const a = pos.get(l.from) ? l.from : pos.get(`more:${fs}`) ? `more:${fs}` : null
    const b = pos.get(l.to) ? l.to : pos.get(`more:${ts}`) ? `more:${ts}` : null
    return a && b ? { ...l, a, b } : null
  }).filter((l): l is NonNullable<typeof l> => !!l)
  const hl = hover ? new Set(shownLinks.filter((l) => l.a === hover || l.b === hover).flatMap((l) => [l.a, l.b])) : null
  const mid = BW / 2, chars = Math.floor((BW - 16) / 7.4)                // account ids are 12 mono characters

  return (
    <div className="netflow" ref={ref}>
      {width > 0 && (
        <div className="tree-canvas" style={{ width: W, height: H }}>
          <svg className={`tree${hl ? ' dim' : ''}`} width={W} height={H} role="img" aria-label={`Money flow around ${center}`}>
            {cols.map((c, ci) => (
              <text key={c.step} x={colX(ci) + mid} y={22} textAnchor="middle" className="tree-head"
                    style={{ fill: c.step === 0 ? 'var(--ink)' : roleVar(majority(c.ids, flow.nodes)) }}>
                {c.step === 0 ? 'Selected account' : `${PLURAL[majority(c.ids, flow.nodes)] ?? 'Accounts'} (${(flow.byStep.get(c.step) ?? []).length})`}
              </text>
            ))}
            {shownLinks.map((l, i) => {
              const p = pos.get(l.a)!, q = pos.get(l.b)!
              const x1 = p.x + BW, y1 = p.y + BH / 2, x2 = q.x - 4, y2 = q.y + BH / 2, mx = (x1 + x2) / 2
              const later = toEpoch(l.e.first_ts) > cutoff
              const on = hl && hl.has(l.a) && hl.has(l.b)
              return (
                <path key={i} className={`tline flowline${later ? ' later' : ''}${on ? ' hl' : ''}`}
                      d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                      style={{ stroke: roleVar(flow.nodes.get(l.to)?.role ?? 'UNKNOWN'), strokeWidth: 1.5 + 8 * Math.sqrt(l.e.total_paise / maxAmt) }} />
              )
            })}
            {cols.map((c) => (
              <g key={c.step}>
                {c.ids.map((id) => {
                  const n = flow.nodes.get(id)!, p = pos.get(id)!
                  const later = id !== center && n.t > cutoff
                  return (
                    <g key={id} className={`tbox${later ? ' later' : ''}${hl?.has(id) ? ' hl' : ''}${id === center ? ' center' : ''}`}
                       transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} data-acct={id} data-role={n.role}
                       aria-label={`${id}: open its money flow`} onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}
                       onFocus={() => setHover(id)} onBlur={() => setHover(null)} onClick={() => onPick(id)}
                       onKeyDown={(ev) => { if (ev.key === 'Enter') onPick(id) }}>
                      <rect width={BW} height={BH} rx={8} style={{ fill: roleBg(n.role), stroke: roleVar(n.role) }} />
                      <text x={mid} y={19} textAnchor="middle" className="tb-acct">{id.length > chars ? `${id.slice(0, chars - 1)}…` : id}</text>
                      <text x={mid} y={36} textAnchor="middle" className="tb-sub">
                        {id === center ? 'selected' : `${inrShort(n.amount)} ${n.step < 0 ? 'paid in' : 'received'}`}</text>
                    </g>
                  )
                })}
                {c.more > 0 && (() => {
                  const p = pos.get(`more:${c.step}`)!
                  const show = () => setOpen((s) => new Set(s).add(c.step))
                  return (
                    <g className="tbox more" transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} aria-label={`Show ${c.more} more accounts`}
                       onClick={show} onKeyDown={(ev) => { if (ev.key === 'Enter') show() }}>
                      <rect width={BW} height={BH} rx={8} style={{ fill: 'var(--sheet)', stroke: 'var(--rule-2)' }} />
                      <text x={mid} y={19} textAnchor="middle" className="tb-more">+{c.more} more</text>
                      <text x={mid} y={36} textAnchor="middle" className="tb-sub">click to show them</text>
                    </g>
                  )
                })()}
              </g>
            ))}
          </svg>
          {hover && pos.get(hover) && <FlowTip ix={ix} id={hover} p={pos.get(hover)!} bw={BW} width={W} />}
        </div>
      )}
    </div>
  )
}

/** Received and passed on inside this network, and what the account kept. */
function FlowTip({ ix, id, p, bw, width }: { ix: Ix; id: string; p: { x: number; y: number }; bw: number; width: number }) {
  const inSum = (ix.inn.get(id) ?? []).reduce((s, e) => s + e.total_paise, 0)
  const outSum = (ix.out.get(id) ?? []).reduce((s, e) => s + e.total_paise, 0)
  const kept = Math.max(0, inSum - outSum)
  const n = ix.role.get(id)
  const left = p.x + bw + 12 + 250 > width ? p.x - 262 : p.x + bw + 12
  return (
    <div className="ttip" style={{ left, top: p.y }} role="tooltip">
      <b className="mono">{id}</b><span className="muted">{n?.bank_prefix} · {ONE[n?.role ?? 'UNKNOWN']}</span>
      {n?.role === 'VICTIM' ? <dl><dt>Paid into the network</dt><dd>{inr(outSum)}</dd></dl> : <>
      <dl>
        <dt>Received in this network</dt><dd>{inr(inSum)}</dd>
        <dt>Passed on</dt><dd>{inr(outSum)}</dd>
        <dt>Kept</dt><dd className={kept > 0 ? 'ok' : ''}>{inr(kept)}</dd>
      </dl>
      {inSum > 0 && <span className="tt-bar"><i style={{ width: `${(100 * kept) / inSum}%` }} /></span>}
      </>}
    </div>
  )
}

function majority(ids: string[], nodes: Map<string, Node>): string {
  const c: Record<string, number> = {}
  for (const id of ids) { const r = nodes.get(id)?.role ?? 'UNKNOWN'; c[r] = (c[r] ?? 0) + 1 }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UNKNOWN'
}

/** Steps away from the centre: negative = paid into it (up to 2 back), positive = its money onward (up to 3).
 *  Onward steps respect time: money can only leave after it arrived. */
function buildFlow(ix: Ix, center: string, hidden: Set<string>) {
  const role = (a: string) => ix.role.get(a)?.role ?? 'UNKNOWN'
  const nodes = new Map<string, Node>([[center, { id: center, role: role(center), step: 0, amount: 0, t: 0 }]])
  const links: { from: string; to: string; e: GraphEdge }[] = []
  let front = new Map([[center, -Infinity]])
  for (let step = 1; step <= 3 && front.size; step++) {
    const next = new Map<string, number>()
    for (const [u, t] of front) for (const e of ix.out.get(u) ?? []) {
      if (toEpoch(e.last_ts) < t || hidden.has(role(e.dst))) continue
      const known = nodes.get(e.dst)
      if (!known) {
        nodes.set(e.dst, { id: e.dst, role: role(e.dst), step, amount: e.total_paise, t: toEpoch(e.first_ts) })
        next.set(e.dst, toEpoch(e.first_ts))
      } else if (known.step === step) known.amount += e.total_paise
      if ((nodes.get(e.dst)!.step) === step) links.push({ from: u, to: e.dst, e })
    }
    front = next
  }
  front = new Map([[center, Infinity]])
  for (let step = -1; step >= -2 && front.size; step--) {
    const next = new Map<string, number>()
    for (const [v, t] of front) for (const e of ix.inn.get(v) ?? []) {
      if (toEpoch(e.first_ts) > t || hidden.has(role(e.src))) continue
      const known = nodes.get(e.src)
      if (!known) {
        nodes.set(e.src, { id: e.src, role: role(e.src), step, amount: e.total_paise, t: toEpoch(e.first_ts) })
        next.set(e.src, toEpoch(e.last_ts))
      } else if (known.step === step) known.amount += e.total_paise
      if ((nodes.get(e.src)!.step) === step) links.push({ from: e.src, to: v, e })
    }
    front = next
  }
  const byStep = new Map<number, string[]>()
  for (const n of nodes.values()) (byStep.get(n.step) ?? byStep.set(n.step, []).get(n.step)!).push(n.id)
  for (const ids of byStep.values()) ids.sort((a, b) => nodes.get(b)!.amount - nodes.get(a)!.amount || a.localeCompare(b))
  const steps = [...byStep.keys()].sort((a, b) => a - b)
  return { nodes, links, byStep, steps }
}
