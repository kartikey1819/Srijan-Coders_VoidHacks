import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { inr, inrShort } from '../format'
import { victimsReaching, type ringIndex } from '../ringJourney'
import type { TraceResult } from '../types'
import { TrailTree } from './trace/TrailTree'

type Ix = ReturnType<typeof ringIndex>

/** One victim's money trail through the isolated account, laid out like the trace screen (victim, collector,
 *  distributors, cash-out). The network's other victims are one choice away; the whole network is the Globe view. */
export function RingTrail({ ix, seed, mark, cursor, onSelect }: {
  ix: Ix; seed: string; mark: string | null; cursor: number; onSelect: (a: string) => void
}) {
  const victims = useMemo(() => victimsReaching(ix, seed), [ix, seed])
  const [victim, setVictim] = useState<string | null>(victims[0]?.account ?? null)
  const [victimsWas, setVictimsWas] = useState(victims)
  if (victims !== victimsWas) { setVictimsWas(victims); setVictim(victims[0]?.account ?? null) }   // another account: its largest victim
  // the latest trace result, tagged with its victim so a result for another victim never shows
  const [result, setResult] = useState<{ victim: string; trace: TraceResult | null; err: string | null } | null>(null)
  const { trace = null, err = null } = result?.victim === victim ? result : {}
  useEffect(() => {
    if (!victim) return
    let live = true
    api.trace(victim).then((t) => live && setResult({ victim, trace: t, err: null }))
      .catch((e) => live && setResult({ victim, trace: null, err: String(e.message ?? e) }))
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
