import { toEpoch } from './format'
import type { GraphEdge, RingResult } from './types'

export interface Hop { account: string; role: string; bank: string; total: number; n: number; first: string }
export interface Journey {
  nodes: Set<string>          // every account on a path through the selected one (up to 4 hops each way)
  links: Set<string>          // "src>dst" keys on those paths
  from: Hop[]                 // direct senders, biggest first
  to: Hop[]                   // direct receivers, biggest first
  upstream: number
  downstream: number
}

export function ringIndex(ring: RingResult) {
  const out = new Map<string, GraphEdge[]>(), inn = new Map<string, GraphEdge[]>()
  for (const e of ring.edges) {
    (out.get(e.src) ?? out.set(e.src, []).get(e.src)!).push(e)
    ;(inn.get(e.dst) ?? inn.set(e.dst, []).get(e.dst)!).push(e)
  }
  const role = new Map(ring.nodes.map((n) => [n.account, n]))
  return { out, inn, role }
}

/** All money paths through `acct` inside the ring: senders upstream and receivers downstream, time-respecting
 *  (a downstream transfer must start no earlier than the money arrived), up to `hops` each way. */
export function journeyOf(ix: ReturnType<typeof ringIndex>, acct: string, hops = 4): Journey {
  const nodes = new Set([acct]), links = new Set<string>()
  // downstream
  let frontier = new Map([[acct, -Infinity]])
  let down = 0
  for (let h = 0; h < hops && frontier.size; h++) {
    const next = new Map<string, number>()
    for (const [u, t] of frontier) {
      for (const e of ix.out.get(u) ?? []) {
        const te = toEpoch(e.last_ts)
        if (te < t) continue
        links.add(`${e.src}>${e.dst}`)
        if (!nodes.has(e.dst)) { nodes.add(e.dst); down++; next.set(e.dst, toEpoch(e.first_ts)) }
      }
    }
    frontier = next
  }
  // upstream
  frontier = new Map([[acct, Infinity]])
  let up = 0
  for (let h = 0; h < hops && frontier.size; h++) {
    const next = new Map<string, number>()
    for (const [v, t] of frontier) {
      for (const e of ix.inn.get(v) ?? []) {
        const ts = toEpoch(e.first_ts)
        if (ts > t) continue
        links.add(`${e.src}>${e.dst}`)
        if (!nodes.has(e.src)) { nodes.add(e.src); up++; next.set(e.src, toEpoch(e.last_ts)) }
      }
    }
    frontier = next
  }
  const hop = (e: GraphEdge, other: string): Hop => {
    const n = ix.role.get(other)
    return { account: other, role: n?.role ?? 'UNKNOWN', bank: n?.bank_prefix ?? '', total: e.total_paise, n: e.n_txn, first: e.first_ts }
  }
  const from = (ix.inn.get(acct) ?? []).map((e) => hop(e, e.src)).sort((a, b) => b.total - a.total)
  const to = (ix.out.get(acct) ?? []).map((e) => hop(e, e.dst)).sort((a, b) => b.total - a.total)
  return { nodes, links, from, to, upstream: up, downstream: down }
}

export interface Candidate { account: string; amount: number }

/** Victims whose money can reach `acct` inside the network (walking payers back up to five steps), largest payment
 *  into the network first. A victim account is its own only candidate. */
export function victimsReaching(ix: ReturnType<typeof ringIndex>, acct: string): Candidate[] {
  if (ix.role.get(acct)?.role === 'VICTIM') return [{ account: acct, amount: (ix.out.get(acct) ?? []).reduce((s, e) => s + e.total_paise, 0) }]
  const seen = new Set([acct])
  let front = [acct]
  for (let step = 0; step < 5 && front.length; step++) {
    const next: string[] = []
    for (const v of front) for (const e of ix.inn.get(v) ?? []) if (!seen.has(e.src)) { seen.add(e.src); next.push(e.src) }
    front = next
  }
  return [...seen].filter((a) => ix.role.get(a)?.role === 'VICTIM')
    .map((a) => ({ account: a, amount: (ix.out.get(a) ?? []).reduce((s, e) => s + e.total_paise, 0) }))
    .sort((a, b) => b.amount - a.amount || a.account.localeCompare(b.account))
}
