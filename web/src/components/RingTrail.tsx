import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { inr, inrShort } from '../format'
import type { ringIndex } from '../ringJourney'
import type { TraceResult } from '../types'
import { TrailTree } from './trace/TrailTree'

type Ix = ReturnType<typeof ringIndex>
interface Candidate { account: string; amount: number }

/** Victims whose money can reach `acct` inside the network (walking payers back up to five steps), largest payment
 *  into the network first. A victim account is its own only candidate. */
export function victimsReaching(ix: Ix, acct: string): Candidate[] {
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

/** One victim's money trail through the isolated account, laid out like the trace screen (victim, collector,
 *  distributors, cash-out). The network's other victims are one choice away; the whole network is the Globe view. */
export function RingTrail({ ix, seed, mark, cursor, onSelect }: {
  ix: Ix; seed: string; mark: string | null; cursor: number; onSelect: (a: string) => void
}) {
  const victims = useMemo(() => victimsReaching(ix, seed), [ix, seed])
  const [victim, setVictim] = useState<string | null>(victims[0]?.account ?? null)
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setVictim(victims[0]?.account ?? null) }, [victims])
  useEffect(() => {
    if (!victim) return
    let live = true
    setTrace(null); setErr(null)
    api.trace(victim).then((t) => live && setTrace(t)).catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [victim])

  if (!victims.length) return <p className="muted rt-empty">No victim's money reaches {seed} inside this network. Switch to the Globe to see every account.</p>
  const count = (r: string) => trace?.nodes.filter((n) => n.role === r).length ?? 0
  const reaches = !trace || trace.nodes.some((n) => n.account === seed)
  return (
    <div className="ring-trail">
      <div className="rt-bar">
        <label className="rt-pick">Victim
          <select value={victim ?? ''} onChange={(e) => setVictim(e.target.value)} aria-label="Victim whose trail is shown"
                  title={`${victims.length} victims' money reached ${seed}`}>
            {victims.map((v) => <option key={v.account} value={v.account}>{v.account} · {inrShort(v.amount)}</option>)}
          </select>
          <span className="muted">of {victims.length}</span>
        </label>
        {trace && <span className="rt-sum small">{inr(trace.loss_paise)} · {count('L1')} collector{count('L1') === 1 ? '' : 's'} · {count('L2')} distributor{count('L2') === 1 ? '' : 's'} · {count('L3')} cash-out</span>}
      </div>
      {!reaches && <p className="banner small" role="status">The traced money of this victim does not reach {seed}: the rules matched its payments to other money. Pick another victim, or use the Globe.</p>}
      {err && <p className="banner bad" role="alert">{err}</p>}
      {!trace && !err && <p className="muted">Tracing {victim}…</p>}
      <div className="rt-fit">
        {trace && <TrailTree trace={trace} cursor={cursor} onSelect={onSelect} mark={mark ?? seed} />}
      </div>
      {trace && (
        <div className="tree-legend">
          <span><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" style={{ stroke: 'var(--l2)' }} strokeWidth="2" /></svg> moved within one hour</span>
          <span><svg width="34" height="8" aria-hidden="true"><line x1="0" y1="4" x2="34" y2="4" style={{ stroke: 'var(--l2)' }} strokeWidth="2" strokeDasharray="6 5" /></svg> moved later</span>
        </div>
      )}
    </div>
  )
}
