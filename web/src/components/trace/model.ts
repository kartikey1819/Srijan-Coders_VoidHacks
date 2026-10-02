import { toEpoch } from '../../format'
import type { TraceEdge, TraceNode, TraceResult, TxnRow } from '../../types'

export type LayerKey = 'L1' | 'L2' | 'L3'
export const LAYER_KEYS: LayerKey[] = ['L1', 'L2', 'L3']

/** Everything the trace page states, computed once from the engine's trace (no new facts, only re-arranged). */
export interface TraceView {
  victim: TraceNode
  t0: number                                   // first reported payment (the theft), epoch s
  tEnd: number                                 // last transfer on the trail
  spanS: number
  mules: TraceNode[]                           // every non-victim account on the trail
  banks: string[]                              // bank prefixes of the mules
  counts: Record<LayerKey, number>
  received: Record<LayerKey, number>           // victim money that reached each layer (paise)
  firstAt: Partial<Record<LayerKey, number>>   // when a layer first received victim money
  freeze: TraceNode[]                          // accounts still holding victim money, most first
  freezeTotal: number
  freezeBanks: number
  recPct: number                               // share of the loss still held
  seeds: TraceEdge[]
  collector: TraceNode | null                  // the Layer 1 account that received the most
  passPct: number                              // share of the collector's victim money it passed on
  passMin: number | null                       // minutes until it had passed on 90 % (or all it did pass on)
}

export function buildView(t: TraceResult): TraceView {
  const victim = t.nodes.find((n) => n.role === 'VICTIM') ?? t.nodes[0]
  const mules = t.nodes.filter((n) => n.role !== 'VICTIM')
  const times = t.edges.map((e) => toEpoch(e.ts))
  const seeds = t.edges.filter((e) => e.rule === 'seed')
  const t0 = seeds.length ? Math.min(...seeds.map((e) => toEpoch(e.ts))) : Math.min(...times)
  const tEnd = Math.max(...times)
  const counts = { L1: 0, L2: 0, L3: 0 }, received = { L1: 0, L2: 0, L3: 0 }
  const firstAt: Partial<Record<LayerKey, number>> = {}
  for (const n of mules) {
    if (n.role === 'L1' || n.role === 'L2' || n.role === 'L3') {
      counts[n.role]++
      received[n.role] += n.received_paise
      if (n.first_in_ts) {
        const ft = toEpoch(n.first_in_ts)
        if (firstAt[n.role] === undefined || ft < firstAt[n.role]!) firstAt[n.role] = ft
      }
    }
  }
  const byAcct = new Map(t.nodes.map((n) => [n.account, n]))
  const freeze = t.freeze_candidates.map((a) => byAcct.get(a)).filter((n): n is TraceNode => !!n)
  const freezeTotal = freeze.reduce((s, n) => s + n.held_paise, 0)
  const collector = mules.filter((n) => n.role === 'L1').sort((a, b) => b.received_paise - a.received_paise)[0] ?? null
  let passPct = 0, passMin: number | null = null
  if (collector && collector.received_paise > 0) {
    passPct = Math.round((100 * collector.sent_paise) / collector.received_paise)
    const first = collector.first_in_ts ? toEpoch(collector.first_in_ts) : t0
    const outs = t.edges.filter((e) => e.src === collector.account).sort((a, b) => toEpoch(a.ts) - toEpoch(b.ts))
    let sum = 0
    for (const e of outs) {
      sum += e.attributed_paise
      if (sum >= 0.9 * collector.received_paise) { passMin = (toEpoch(e.ts) - first) / 60; break }
    }
    if (passMin === null && outs.length) passMin = (toEpoch(outs[outs.length - 1].ts) - first) / 60
  }
  return {
    victim, t0, tEnd, spanS: Math.max(0, tEnd - t0), mules,
    banks: [...new Set(mules.map((n) => n.bank_prefix))].sort(),
    counts, received, firstAt, freeze, freezeTotal,
    freezeBanks: new Set(freeze.map((n) => n.bank_prefix)).size,
    recPct: t.loss_paise ? Math.round((100 * freezeTotal) / t.loss_paise) : 0,
    seeds, collector, passPct, passMin,
  }
}

/** Signs of an organised operation, from the trail's own transaction rows (device, IP, narration category). */
export interface Signs { total: number; proxy: number; script: number; cashout: number; automatedPct: number; ranges: string[] }

export function signsOf(t: TraceResult, rows: Map<number, TxnRow>): Signs {
  const moves = t.edges.filter((e) => e.rule !== 'seed')
  let proxy = 0, script = 0, cashout = 0, auto = 0
  const ranges = new Set<string>()
  for (const e of moves) {
    const r = rows.get(e.txn_idx)
    const isProxy = r?.ip_class === 'foreign_proxy', isScript = r?.device_class === 'script'
    if (isProxy) { proxy++; if (r) ranges.add(`${r.ip.split('.')[0]}.x`) }
    if (isScript) script++
    if (isProxy || isScript) auto++
    if (e.terminal) cashout++
  }
  return { total: moves.length, proxy, script, cashout, automatedPct: moves.length ? Math.round((100 * auto) / moves.length) : 0,
           ranges: [...ranges].sort() }
}

/** "+4 min" after the theft, as an officer would read it. */
export function after(s: number): string {
  if (s < 60) return 'same minute'
  if (s < 3600) return `+${Math.round(s / 60)} min`
  if (s < 86400) return `+${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
  return `+${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`
}

/** Minutes with one decimal under an hour ("35.5 minutes"), otherwise hours or days. */
export function duration(s: number): string {
  if (s < 3600) return `${(s / 60).toFixed(s < 600 ? 1 : 0).replace(/\.0$/, '')} minutes`
  if (s < 86400) return `${(s / 3600).toFixed(1).replace(/\.0$/, '')} hours`
  return `${(s / 86400).toFixed(1).replace(/\.0$/, '')} days`
}

/** "22 Sep 2026, 01:13" from the data's "2026-09-22 01:13:51" (times in the file are shown as they are). */
export function when(ts: string): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return ts
  const mon = d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${ts.slice(11, 16)}`
}

/** The engine's warnings, said plainly for an officer. */
export function plainWarning(w: string): string {
  let m = w.match(/^Traced the (\d+) of (\d+) outgoing transfers/)
  if (m) return `Only the victim's ${m[1]} payments (of ${m[2]}) that went to suspicious accounts were followed. Use "Which payments did the victim report?" to change this.`
  m = w.match(/^Victim has (\d+) outgoing transactions; all are treated as the reported loss/)
  if (m) return `All ${m[1]} payments made by the victim are treated as the reported loss.`
  m = w.match(/^(\d+) transfer\(s\) spent money that arrived in the same second/)
  if (m) return `${m[1]} transfer(s) happened in the same second as the money arrived; they are taken in the order of the bank file.`
  m = w.match(/^(\d+) transfer\(s\) could be funded by this victim's money or by other money/)
  if (m) return `${m[1]} transfer(s) could have been paid from this victim's money or from other money that arrived the same way (for example another victim's). Check these accounts before freezing.`
  if (w.startsWith('Part of the traced money flowed back')) return 'Part of the money came back to the victim account.'
  if (w.startsWith('Victim account has no outgoing transactions')) return 'This account sent no money, so there is nothing to follow.'
  return w
}
