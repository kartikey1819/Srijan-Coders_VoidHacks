import { toEpoch } from './format'
import type { TraceResult } from './types'

export type Layer = 'L1' | 'L2' | 'L3'
export const LAYERS: Layer[] = ['L1', 'L2', 'L3']

export interface HeldPoint { t: number; L1: number; L2: number; L3: number }

export interface Trail {
  t0: number                       // first disputed transfer (the theft), epoch s
  tEnd: number                     // last transfer on the trail
  times: number[]                  // every transfer time on the trail, sorted (for stepping)
  arrival: Map<string, number>     // account -> epoch s of first victim money in
  role: Map<string, string>
  held: HeldPoint[]                // victim money sitting in each layer, after each event (step series)
  heldNow: number                  // sum held by non-victim accounts at the end
}

/** Facts derived only from the trace's own edges: no new numbers, just re-arranged in time. */
export function deriveTrail(trace: TraceResult): Trail {
  const role = new Map(trace.nodes.map((n) => [n.account, n.role]))
  const ev = trace.edges.map((e) => ({ t: toEpoch(e.ts), e })).sort((a, b) => a.t - b.t || a.e.txn_idx - b.e.txn_idx)
  const times = ev.map((x) => x.t)
  const t0 = ev.find((x) => x.e.rule === 'seed')?.t ?? times[0] ?? 0
  const arrival = new Map<string, number>()
  for (const n of trace.nodes) if (n.first_in_ts) arrival.set(n.account, toEpoch(n.first_in_ts))
  const cur: Record<Layer, number> = { L1: 0, L2: 0, L3: 0 }
  const held: HeldPoint[] = [{ t: t0, L1: 0, L2: 0, L3: 0 }]
  for (const { t, e } of ev) {
    const s = role.get(e.src), d = role.get(e.dst)
    if (s === 'L1' || s === 'L2' || s === 'L3') cur[s] -= e.attributed_paise
    if (d === 'L1' || d === 'L2' || d === 'L3') cur[d] += e.attributed_paise
    const last = held[held.length - 1]
    if (last.t === t) Object.assign(last, cur)
    else held.push({ t, ...cur })
  }
  const heldNow = trace.nodes.reduce((s, n) => s + (n.role === 'VICTIM' ? 0 : n.held_paise), 0)
  return { t0, tEnd: times[times.length - 1] ?? t0, times, arrival, role, held, heldNow }
}

/** Held amounts at time t (step function). */
export function heldAt(trail: Trail, t: number): HeldPoint {
  let lo = 0, hi = trail.held.length - 1, ans = 0
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (trail.held[m].t <= t) { ans = m; lo = m + 1 } else hi = m - 1
  }
  return trail.held[ans]
}

export function nextTime(times: number[], t: number, dir: 1 | -1): number | null {
  if (dir > 0) { for (const x of times) if (x > t) return x; return null }
  for (let i = times.length - 1; i >= 0; i--) if (times[i] < t) return times[i]
  return null
}
